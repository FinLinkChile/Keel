// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {ITradeEscrow} from "./ITradeEscrow.sol";
import {
    PurchaseOrder,
    ShipmentAttestation,
    CancelOrder,
    BalanceApproval,
    DisputeResolution,
    DocumentDecision
} from "./KeelTypes.sol";
import {KeelHash} from "./KeelHash.sol";

/// @title TradeEscrow
/// @notice Escrow of Keel Trade (task T1.9). Holds the total of a purchase order signed by
/// importer and exporter and only releases it along the state machine: the advance in the
/// same transaction as the deposit, the balance after the carrier attests an on-time shipment and either the order's
/// document verifier or the importer approves it, a refund to the importer after the
/// deadline, an arbiter split in a dispute, or a mutual cancellation.
/// Funds of an order only ever go to its `importer` or to its signed `payoutAddress`.
/// @dev Area 1 corrections C1 to C5 (contracts/CLAUDE.md, section 6):
/// C1 shipment and balance are separate steps; SHIPPED has no refund path, and the balance
///    leaves by releaseBalance (verifier, after the window), approveBalance (importer, any
///    time) or a dispute (either party, any time);
/// C2 orderId = keccak256(abi.encode(importer, exporter, nonce));
/// C3 refund from ADVANCE_PAID (the deposit and the advance happen together in fund);
/// C4 the used-BL key is keccak256(abi.encode(order.carrier, blNumberHash));
/// C5 disputeWindow = 0 lets releaseBalance run right after the shipment.
/// Every signature is EIP-712 over domain ("Keel", "1", chainId, this contract) and is
/// checked with SignatureChecker, so EOAs and ERC-1271 wallets (Safes) can sign.
/// Every state transition increments the order's stateVersion. CancelOrder signs
/// cancelNonceOf(orderId) = (stateVersion << 8) | uint8(state), so a cancel signature is
/// only valid in the exact version and state it was signed for.
/// Declared risk: once an order is DISPUTED, only the arbiter (resolve) or both parties
/// together (cancel) can move its funds. There is no dispute timeout: if the arbiter is
/// unavailable and the parties do not agree, the remaining balance stays in the escrow.
/// Timestamps: every comparison with block.timestamp is against deadlines, windows and
/// expiries of hours or days; a block producer can only shift the timestamp by seconds, and
/// refundGrace absorbs that before a refund. The block-timestamp lint is disabled per line.
contract TradeEscrow is ITradeEscrow, EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 private constant BPS = 10_000;

    /// @notice The only token this escrow accepts (one token in the prototype).
    IERC20 public immutable token;
    /// @notice Grace period after shipmentDeadline before a refund (open decision 6, proposal).
    uint64 public immutable refundGrace;

    mapping(bytes32 orderId => OrderRecord) private _orders;
    mapping(bytes32 blKey => bool) private _blUsed;

    constructor(IERC20 token_, uint64 refundGrace_) EIP712("Keel", "1") {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        refundGrace = refundGrace_;
    }

    // ================================================================== open

    /// @notice Registers a purchase order signed by importer and exporter. Anyone can submit it.
    /// @dev Declared risk: orderId commits to (importer, exporter, nonce), not to the terms. If
    /// the parties sign two versions with the same nonce, whoever opens first fixes the
    /// version and the other reverts with OrderExists. Rule for the engine and the app: every
    /// new version of an order uses a new nonce. The Trade gate also binds FundIntent.orderHash
    /// to orderOf(orderId).orderHash before funding.
    /// Separation of roles: the verifier, the carrier and the arbiter must differ from the
    /// importer, the exporter and the payoutAddress, and the verifier from the carrier and the
    /// arbiter. Only identical addresses are detected here: another address controlled by a
    /// party is not. Requiring the verifier to be Keel's key is enforced by the engine and the
    /// Trade gate, not by this contract.
    /// @param po The purchase order. `po.orderId` must be derived from importer, exporter and nonce.
    /// @param sigImporter EIP-712 signature of `po.importer` over the order.
    /// @param sigExporter EIP-712 signature of `po.exporter` over the order.
    /// @return orderHash EIP-712 struct hash of the order (what FundIntent.orderHash binds).
    function open(PurchaseOrder calldata po, bytes calldata sigImporter, bytes calldata sigExporter)
        external
        returns (bytes32 orderHash)
    {
        if (po.orderId != keccak256(abi.encode(po.importer, po.exporter, po.nonce))) revert BadOrderId();
        if (_orders[po.orderId].state != State.NONE) revert OrderExists();
        if (po.token != address(token)) revert TokenNotAllowed();
        _checkOrderShape(po);

        orderHash = KeelHash.hash(po);
        bytes32 digest = _hashTypedDataV4(orderHash);
        if (!SignatureChecker.isValidSignatureNowCalldata(po.importer, digest, sigImporter)) {
            revert BadImporterSignature();
        }
        if (!SignatureChecker.isValidSignatureNowCalldata(po.exporter, digest, sigExporter)) {
            revert BadExporterSignature();
        }

        OrderRecord storage o = _orders[po.orderId];
        o.po = po;
        o.orderHash = orderHash;
        _transition(o, State.OPEN);

        // The only earlier external calls are the ERC-1271 checks of SignatureChecker (staticcall).
        // forge-lint: disable-next-line(reentrancy-events)
        emit OrderOpened(po.orderId, orderHash, po.importer, po.exporter, po.payoutAddress, po.totalAmount);
    }

    // ================================================================== fund

    /// @notice Pulls exactly `totalAmount` from the importer and, in the same transaction, pays
    /// the advance (`totalAmount * advanceBps / 10000`) to the signed payout address.
    /// Requires an exact prior approval. OPEN goes straight to ADVANCE_PAID.
    /// @dev Open decision 2, closed by Area 1: the advance is released inside `fund`, so there
    /// is no intermediate state to race against a cancel. Only the importer of the order can
    /// fund, and only before shipmentDeadline. The received amount is measured as a balance
    /// difference (AmountMismatch otherwise) before the advance leaves. With advanceBps = 0 no
    /// advance is transferred.
    function fund(bytes32 orderId) external nonReentrant {
        OrderRecord storage o = _orders[orderId];
        if (o.state != State.OPEN) revert InvalidState();
        if (msg.sender != o.po.importer) revert NotParty();
        // Deadlines are days long; a block producer can only shift the timestamp by seconds.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= o.po.shipmentDeadline) revert DeadlinePassed();

        uint256 amount = o.po.totalAmount;
        uint256 advance = (amount * o.po.advanceBps) / BPS;
        address payoutAddress = o.po.payoutAddress;
        o.funded = true;
        o.paidOut = advance;
        _transition(o, State.ADVANCE_PAID);
        emit OrderFunded(orderId, amount);
        emit AdvanceReleased(orderId, payoutAddress, advance);

        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        // Exact equality is the point: a fee-on-transfer token must not fund a short deposit.
        // forge-lint: disable-next-line(incorrect-strict-equality)
        if (token.balanceOf(address(this)) - before != amount) revert AmountMismatch();

        _pay(payoutAddress, advance);
    }

    // ================================================================== shipment

    /// @notice Accepts the carrier's attestation of an on-time shipment. Anyone can submit it.
    /// No money moves here (C1), and from SHIPPED there is no refund.
    /// @param att The attestation, signed by the carrier fixed in the order.
    /// @param sigCarrier EIP-712 signature of `po.carrier` over the attestation.
    function submitShipment(bytes32 orderId, ShipmentAttestation calldata att, bytes calldata sigCarrier)
        external
        nonReentrant
    {
        OrderRecord storage o = _orders[orderId];
        if (o.state != State.ADVANCE_PAID) revert InvalidState();
        if (att.orderId != orderId) revert InvalidAttestation();

        bytes32 attestationHash = KeelHash.hash(att);
        address carrier = o.po.carrier;
        if (!SignatureChecker.isValidSignatureNowCalldata(carrier, _hashTypedDataV4(attestationHash), sigCarrier)) {
            revert BadCarrierSignature();
        }
        if (att.onBoardDate > o.po.shipmentDeadline) revert ShipmentTooLate();
        // forge-lint: disable-next-line(block-timestamp)
        if (att.onBoardDate > block.timestamp) revert InvalidAttestation();

        bytes32 blKey = keccak256(abi.encode(carrier, att.blNumberHash));
        if (_blUsed[blKey]) revert BillOfLadingAlreadyUsed();

        _blUsed[blKey] = true;
        o.attestationHash = attestationHash;
        o.docsHash = att.docsHash;
        // uint64 seconds overflow in year 2^64 / 3.15e7, far beyond any order.
        // forge-lint: disable-next-line(unsafe-typecast)
        o.shippedAt = uint64(block.timestamp);
        _transition(o, State.SHIPPED);

        // The only earlier external call is the ERC-1271 check of SignatureChecker (staticcall).
        // forge-lint: disable-next-line(reentrancy-events)
        emit ShipmentAccepted(orderId, attestationHash, blKey, att.onBoardDate);
    }

    // ================================================================== balance

    /// @notice Pays the balance once the dispute window closed, with a DocumentDecision signed
    /// by the order's `documentVerifier` that binds this order, its attestation and its
    /// documents. Anyone can submit it.
    /// @dev The decision is mandatory for this path (there is no automatic release). If the
    /// verifier is down, the importer can approve (approveBalance) or either party can dispute.
    /// @param sigVerifier EIP-712 signature of `po.documentVerifier` over the decision.
    function releaseBalance(bytes32 orderId, DocumentDecision calldata d, bytes calldata sigVerifier)
        external
        nonReentrant
    {
        OrderRecord storage o = _orders[orderId];
        if (o.state != State.SHIPPED) revert InvalidState();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < uint256(o.shippedAt) + o.po.disputeWindow) revert DeadlineNotReached();
        if (
            d.orderId != orderId || d.attestationHash != o.attestationHash || d.docsHash != o.docsHash
                // forge-lint: disable-next-line(block-timestamp)
                || block.timestamp > d.expiresAt
        ) {
            revert BadDocumentDecision();
        }

        bytes32 decisionDigest = _hashTypedDataV4(KeelHash.hash(d));
        if (!SignatureChecker.isValidSignatureNowCalldata(o.po.documentVerifier, decisionDigest, sigVerifier)) {
            revert BadDocumentDecision();
        }

        _settle(orderId, o, decisionDigest);
    }

    /// @notice Pays the balance at any time after the shipment, with the importer's signature
    /// over BalanceApproval{orderId, accepted attestationHash}. The importer waives the window.
    /// @dev The BalanceApproval is built here from storage, never taken from outside.
    /// @param sigImporter EIP-712 signature of `po.importer` (EOA or ERC-1271) over the approval.
    function approveBalance(bytes32 orderId, bytes calldata sigImporter) external nonReentrant {
        OrderRecord storage o = _orders[orderId];
        if (o.state != State.SHIPPED) revert InvalidState();

        bytes32 approvalDigest =
            _hashTypedDataV4(KeelHash.hash(BalanceApproval({orderId: orderId, attestationHash: o.attestationHash})));
        if (!SignatureChecker.isValidSignatureNowCalldata(o.po.importer, approvalDigest, sigImporter)) {
            revert BadImporterSignature();
        }

        _settle(orderId, o, approvalDigest);
    }

    // ================================================================== refund

    /// @notice Returns the unreleased balance to the importer after shipmentDeadline plus
    /// refundGrace, if no shipment was accepted. Anyone can call.
    function refundAfterDeadline(bytes32 orderId) external nonReentrant {
        OrderRecord storage o = _orders[orderId];
        if (o.state != State.ADVANCE_PAID) revert InvalidState();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= uint256(o.po.shipmentDeadline) + refundGrace) revert DeadlineNotReached();

        uint256 amount = _remaining(o);
        address importer = o.po.importer;
        o.paidOut += amount;
        _transition(o, State.REFUNDED);
        emit Refunded(orderId, importer, amount);

        _pay(importer, amount);
    }

    // ================================================================== dispute

    /// @notice Freezes the remaining funds until the arbiter resolves or both parties cancel.
    /// Only importer or exporter.
    /// @dev Open from ADVANCE_PAID and SHIPPED, with no time limit in SHIPPED: it is
    /// the exit that keeps the balance from being trapped when the verifier is down and the
    /// importer does not approve. A party can use it to delay payment; the arbiter decides.
    function raiseDispute(bytes32 orderId) external {
        OrderRecord storage o = _orders[orderId];
        State s = o.state;
        if (s != State.ADVANCE_PAID && s != State.SHIPPED) revert InvalidState();
        if (msg.sender != o.po.importer && msg.sender != o.po.exporter) revert NotParty();

        _transition(o, State.DISPUTED);
        emit DisputeRaised(orderId, msg.sender);
    }

    /// @notice Splits the remaining balance between the importer and the payout address, as
    /// signed by the arbiter. Anyone can submit it.
    /// @dev The DisputeResolution is built here from the arguments, never taken from outside.
    /// The arbiter can only choose the split; the recipients are fixed by the order.
    function resolve(bytes32 orderId, uint256 toImporter, uint256 toExporter, bytes calldata sigArbiter)
        external
        nonReentrant
    {
        OrderRecord storage o = _orders[orderId];
        if (o.state != State.DISPUTED) revert InvalidState();
        uint256 remaining = _remaining(o);
        if (toImporter + toExporter != remaining) revert BadResolution();

        bytes32 structHash =
            KeelHash.hash(DisputeResolution({orderId: orderId, toImporter: toImporter, toExporter: toExporter}));
        if (!SignatureChecker.isValidSignatureNowCalldata(o.po.arbiter, _hashTypedDataV4(structHash), sigArbiter)) {
            revert BadArbiterSignature();
        }

        address importer = o.po.importer;
        address payoutAddress = o.po.payoutAddress;
        o.paidOut += remaining;
        _transition(o, State.RESOLVED);
        // Emitted before paying; the only earlier external call is the ERC-1271 check (staticcall).
        // forge-lint: disable-next-line(reentrancy-events)
        emit DisputeResolved(orderId, toImporter, toExporter);

        _pay(importer, toImporter);
        _pay(payoutAddress, toExporter);
    }

    // ================================================================== cancel

    /// @notice Cancels by mutual agreement and returns the unreleased balance to the importer.
    /// Allowed from OPEN, ADVANCE_PAID and DISPUTED.
    /// @dev CancelOrder{orderId, nonce: cancelNonceOf(orderId)} is built here and both parties
    /// sign it with EIP-712, so a cancel signature is only valid in the exact version and
    /// state it was signed for.
    function cancel(bytes32 orderId, bytes calldata sigImporter, bytes calldata sigExporter) external nonReentrant {
        OrderRecord storage o = _orders[orderId];
        State s = o.state;
        if (s != State.OPEN && s != State.ADVANCE_PAID && s != State.DISPUTED) revert InvalidState();

        bytes32 digest = _hashTypedDataV4(KeelHash.hash(CancelOrder({orderId: orderId, nonce: _cancelNonce(o)})));
        if (!SignatureChecker.isValidSignatureNowCalldata(o.po.importer, digest, sigImporter)) {
            revert BadImporterSignature();
        }
        if (!SignatureChecker.isValidSignatureNowCalldata(o.po.exporter, digest, sigExporter)) {
            revert BadExporterSignature();
        }

        uint256 amount = o.funded ? _remaining(o) : 0;
        address importer = o.po.importer;
        o.paidOut += amount;
        _transition(o, State.CANCELLED);
        // Emitted before paying; the only earlier external calls are the ERC-1271 checks (staticcall).
        // forge-lint: disable-next-line(reentrancy-events)
        emit OrderCancelled(orderId, amount);

        _pay(importer, amount);
    }

    // ================================================================== views

    /// @notice Full record of an order: the signed order, state, stateVersion, orderHash,
    /// amount paid out, accepted attestation and whether it was funded.
    function orderOf(bytes32 orderId) external view returns (OrderRecord memory) {
        return _orders[orderId];
    }

    /// @notice The nonce both parties must sign in CancelOrder for this order right now:
    /// (stateVersion << 8) | uint8(state). It changes on every state transition.
    function cancelNonceOf(bytes32 orderId) external view returns (uint256) {
        return _cancelNonce(_orders[orderId]);
    }

    /// @notice Whether a BL key, keccak256(abi.encode(carrier, blNumberHash)), was already used.
    function isBlUsed(bytes32 blKey) external view returns (bool) {
        return _blUsed[blKey];
    }

    // ================================================================== internal

    /// @dev Structural checks of a purchase order (InvalidOrder).
    function _checkOrderShape(PurchaseOrder calldata po) private view {
        address imp = po.importer;
        address exp = po.exporter;
        address verifier = po.documentVerifier;
        if (
            imp == address(0) || exp == address(0) || po.payoutAddress == address(0) || po.carrier == address(0)
                || po.arbiter == address(0) || verifier == address(0)
        ) revert InvalidOrder();
        if (imp == exp) revert InvalidOrder();
        if (po.carrier == imp || po.carrier == exp || po.arbiter == imp || po.arbiter == exp) revert InvalidOrder();
        if (verifier == imp || verifier == exp || verifier == po.carrier) revert InvalidOrder();
        address payoutAddress = po.payoutAddress;
        if (
            verifier == payoutAddress || verifier == po.arbiter || po.carrier == payoutAddress
                || po.arbiter == payoutAddress
        ) revert InvalidOrder();
        if (imp == address(this) || po.payoutAddress == address(this)) revert InvalidOrder();
        if (po.advanceBps > BPS || po.totalAmount == 0) revert InvalidOrder();
        // forge-lint: disable-next-line(block-timestamp)
        if (po.shipmentDeadline <= block.timestamp) revert InvalidOrder();
    }

    function _cancelNonce(OrderRecord storage o) private view returns (uint256) {
        return (uint256(o.stateVersion) << 8) | uint256(uint8(o.state));
    }

    /// @dev The only place that writes `state`, so every transition bumps stateVersion.
    function _transition(OrderRecord storage o, State next) private {
        o.state = next;
        ++o.stateVersion;
    }

    /// @dev SHIPPED to SETTLED, paying the remaining balance to the payout address.
    function _settle(bytes32 orderId, OrderRecord storage o, bytes32 authorizationDigest) private {
        uint256 amount = _remaining(o);
        address payoutAddress = o.po.payoutAddress;
        o.paidOut += amount;
        _transition(o, State.SETTLED);
        // Emitted before paying; the only earlier external call is an ERC-1271 check (staticcall).
        // forge-lint: disable-next-line(reentrancy-events)
        emit BalanceReleased(orderId, payoutAddress, amount, authorizationDigest);

        _pay(payoutAddress, amount);
    }

    function _remaining(OrderRecord storage o) private view returns (uint256) {
        return o.po.totalAmount - o.paidOut;
    }

    /// @dev Zero amounts are skipped so tokens that revert on zero transfers cannot block a transition.
    function _pay(address to, uint256 amount) private {
        if (amount != 0) token.safeTransfer(to, amount);
    }
}
