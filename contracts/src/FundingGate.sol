// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IRoles} from "./IRoles.sol";
import {ITradeEscrow} from "./ITradeEscrow.sol";
import {TradeEscrow} from "./TradeEscrow.sol";
import {FundIntent, PolicyDecision, PurchaseOrder} from "./KeelTypes.sol";
import {KeelHash} from "./KeelHash.sol";
import {PDRVerifier} from "./PDRVerifier.sol";

/// @title FundingGate
/// @notice Gate of Keel Trade (T1.6, Trade part; T1.11). Sole member of the AGENT and
/// AGENT_COSIGNED roles in the Zodiac Roles Modifier of the importer Safe (decision D4). It
/// funds an order of the TradeEscrow (exact `approve` plus `fund`, step 2 of the flow) only if
/// it carries a Policy Decision Record that binds the exact calldata built here, the order is
/// the open one this Safe signed as importer, and the supplier (exporter and payout address)
/// and the carrier, arbiter and document verifier of the order are active in the trust
/// registries of this Safe.
///
/// Security goal: neither the AI, nor the agent key, nor the policy key, nor the cosigner key
/// (even stolen together) can fund an order that pays a payout address or uses a carrier,
/// arbiter or document verifier the company did not approve; approving something new always
/// waits `configDelay` with a veto, enforced by this contract. Proven by
/// test_goal_stolenPolicyKey_newPayoutReverts, test_goal_stolenPolicyAndCosignerKeys_tier3StillReverts,
/// test_goal_exporterControlledCarrierReverts and testFuzz_fundingImpliesActiveSupplier
/// (test/FundingGate.t.sol). It does not hold against the Safe owners themselves: they can queue
/// an address and wait the delay; the defense there is the veto during the wait.
///
/// @dev Why the registries live here with their own delay instead of behind the Zodiac Delay
/// Modifier: the Delay vetoes with `setTxNonce`, which cancels every pending transaction at once,
/// and without a ConfigGuard (T1.5, not built) the owners can call the target directly and skip
/// the Delay. Here the contract that pays enforces the wait, and each queued change has its own
/// veto. The Delay still covers the rest of the configuration (policy signer, cosigner, policy
/// version, Roles membership and allowances).
/// Roles still applies after every check passes: target, selector, spender and allowance.
/// Deployment invariant (checked by the deployment script and the fork tests, T1.7/T1.8): no
/// Roles role of this Safe may have this gate as a target. `onlySafe` trusts `msg.sender == safe`,
/// so a role scoped to this gate would let its member queue suppliers as if it were the Safe.
/// The cosigner does not need one: it calls `vetoPending` and `emergencyPause` directly.
/// Declared risk: a stolen cosigner key can veto every queued change and pause the gate (it can
/// delay onboarding, never add anything) until the Safe rotates it with `setCosigner`.
contract FundingGate is PDRVerifier, ReentrancyGuard {
    // ----------------------------------------------------------------- types
    enum ChangeKind {
        NONE,
        SUPPLIER,
        THIRD_PARTY
    }

    /// @param kind SUPPLIER: (subject = exporter, payout); THIRD_PARTY: (subject = party, roles).
    /// @param activatesAt The change counts from this timestamp on (inclusive).
    /// @param vetoed Set by `vetoPending`.
    struct Change {
        ChangeKind kind;
        address subject;
        address payout;
        uint8 roles;
        uint64 activatesAt;
        bool vetoed;
    }

    /// @dev One registry entry (a supplier pair, or one role of a third party). `changeId == 0`
    /// means there is no entry.
    struct Entry {
        uint192 changeId;
        uint64 activatesAt;
    }

    // ----------------------------------------------------------------- constants
    uint8 public constant CARRIER = 1;
    uint8 public constant ARBITER = 2;
    uint8 public constant VERIFIER = 4;
    uint8 private constant ALL_ROLES = CARRIER | ARBITER | VERIFIER;
    /// @notice Shortest accepted configDelay: below this the veto window is too short to act on.
    /// The demo uses 120 seconds; production is documented at 48 hours.
    uint64 public constant MIN_CONFIG_DELAY = 60;

    // ----------------------------------------------------------------- events
    event FundingExecuted(bytes32 indexed intentHash, bytes32 pdrHash, uint8 tier, bytes32 indexed orderId);
    /// @notice Everything the bot needs to notify a queued change without another query.
    /// @param subject The exporter (SUPPLIER) or the third party (THIRD_PARTY).
    /// @param payout The payout address (SUPPLIER), zero otherwise.
    /// @param roles The role bitmask (THIRD_PARTY), zero otherwise.
    event ChangeQueued(
        uint256 indexed changeId,
        ChangeKind kind,
        address indexed subject,
        address payout,
        uint8 roles,
        uint64 activatesAt
    );
    event ChangeVetoed(uint256 indexed changeId, address indexed by);
    event SupplierRemoved(address indexed exporter, address payout);
    event ThirdPartyRemoved(address indexed party, uint8 roles);

    // ----------------------------------------------------------------- errors
    /// @dev The intent or the stored order does not match: other escrow or token, other order
    /// version (orderHash), or an amount different from the order total.
    error OrderMismatch();
    /// @dev The order is not in OPEN (never opened, already funded, or in any other state).
    error OrderNotOpen();
    /// @dev The importer of the order is not this Safe.
    error NotOwnOrder();
    /// @dev (exporter, payoutAddress) of the order is not active in the supplier registry.
    error UnknownSupplier();
    /// @dev The carrier, arbiter or document verifier is not active with that role.
    error UntrustedParty();
    /// @dev An allowance from the Safe to the escrow is left after `fund`.
    error AllowanceNotConsumed();
    error OnlySafeOrCosigner();
    /// @dev The change does not exist, was vetoed, was removed or replaced, or is already active.
    error ChangeNotPending();
    error AlreadyRegistered();
    error NotRegistered();
    /// @dev Role bitmask is zero or has bits other than CARRIER, ARBITER, VERIFIER; or, in
    /// `hasRole`, is not a single role.
    error InvalidRoles();
    /// @dev configDelay is below MIN_CONFIG_DELAY.
    error InvalidDelay();
    error SameRoleKey();

    // ----------------------------------------------------------------- immutables
    TradeEscrow public immutable escrow;
    bytes32 public immutable agentRoleKey;
    bytes32 public immutable cosignedRoleKey;
    /// @notice Wait before a queued change counts: 120 s in the demo, 48 hours in production.
    uint64 public immutable configDelay;

    // ----------------------------------------------------------------- state
    /// @notice Number of changes ever queued; the next changeId is changeCount + 1.
    uint256 public changeCount;
    /// @notice History of every queued change. `vetoed` is set by `vetoPending` only: a removal
    /// does not update the record, so whether something counts is `isKnownSupplier`/`hasRole`.
    mapping(uint256 changeId => Change) public changes;
    mapping(address exporter => mapping(address payout => Entry)) private _suppliers;
    mapping(address party => mapping(uint8 role => Entry)) private _parties;

    modifier onlySafeOrCosigner() {
        if (msg.sender != safe && msg.sender != cosigner) revert OnlySafeOrCosigner();
        _;
    }

    /// @param escrow_ The TradeEscrow; the payment token is read from it, so they cannot differ.
    /// @param agentRoleKey_ Roles role for tier 1 (allowance per period).
    /// @param cosignedRoleKey_ Roles role for tier 3, only with the cosignature (larger allowance).
    /// @param configDelay_ Wait of every registry addition, at least MIN_CONFIG_DELAY.
    constructor(
        address safe_,
        IRoles roles_,
        TradeEscrow escrow_,
        bytes32 agentRoleKey_,
        bytes32 cosignedRoleKey_,
        address policySigner_,
        address cosigner_,
        bytes32 policyHash_,
        uint64 configDelay_
    ) PDRVerifier(safe_, roles_, _tokenOf(escrow_), policySigner_, cosigner_, policyHash_) {
        if (agentRoleKey_ == cosignedRoleKey_) revert SameRoleKey();
        if (configDelay_ < MIN_CONFIG_DELAY) revert InvalidDelay();
        escrow = escrow_;
        agentRoleKey = agentRoleKey_;
        cosignedRoleKey = cosignedRoleKey_;
        configDelay = configDelay_;
    }

    function _tokenOf(TradeEscrow escrow_) private view returns (IERC20) {
        if (address(escrow_) == address(0)) revert ZeroAddress();
        return escrow_.token();
    }

    // ================================================================== core

    /// @notice Funds an order of the escrow from the Safe: exact `approve` and `fund` in the
    /// same transaction, through Roles. Permissionless: the relayer only pays gas, authority
    /// comes from the signatures. `sigCosigner` is ignored for tier 1 and required for tier 3.
    /// @dev Order of checks: pause, intent binding, escrow and token, the stored order (OPEN,
    /// orderHash, token, amount, importer), the registries, the calldata hash, the PDR (nonce
    /// marked before any state-changing external call), execution, leftover allowance, event.
    /// The cosignature only selects the role with the larger allowance; it never skips the
    /// registries. `escrow.orderOf` is a view (staticcall), and the escrow and token are
    /// immutable, trusted contracts; the function is also nonReentrant.
    function execute(
        FundIntent calldata intent,
        PolicyDecision calldata d,
        bytes calldata sigPolicy,
        bytes calldata sigCosigner
    ) external nonReentrant {
        // a. pause
        if (paused) revert GateIsPaused();

        // b. intent binding
        bytes32 intentHash = KeelHash.hash(intent);
        if (intentHash != d.intentHash) revert IntentMismatch();

        // c, d, e. this escrow and token; the open order this Safe signed; the registries
        _checkOrderAndParties(intent);

        // f. calldata built inside the contract, never received from outside
        (bytes memory approveData, bytes memory fundData, bytes32 calldataHash) = _fundingCalldata(intent);
        if (calldataHash != d.calldataHash) revert CalldataMismatch();

        // g. the PDR: tier, policy signature, version, expiries, nonce, cosignature for tier 3
        bytes32 pdrHash = _verifyDecision(d, intent.deadline, intent.nonce, sigPolicy, sigCosigner);

        // h. execution through Roles; tier 3 uses the role with the larger allowance
        _executeFunding(approveData, fundData, d.tier == 3 ? cosignedRoleKey : agentRoleKey);

        // i. the exact approval was spent by fund: nothing is left for the escrow to pull
        if (_token.allowance(safe, address(escrow)) != 0) revert AllowanceNotConsumed();

        // j. after the calls on purpose: the allowance check needs them, and the function is
        // nonReentrant; if anything fails the whole transaction (and its log) reverts.
        // forge-lint: disable-next-line(reentrancy-events)
        emit FundingExecuted(intentHash, pdrHash, d.tier, intent.orderId);
    }

    // ================================================================== registries

    /// @notice Queues a known supplier: the pair (exporter, payout address). It counts from
    /// `block.timestamp + configDelay` on, unless vetoed or removed before.
    /// @return changeId A counter, unique forever (never reused after a veto).
    function queueSupplier(address exporter, address payout) external onlySafe returns (uint256 changeId) {
        if (exporter == address(0) || payout == address(0)) revert ZeroAddress();
        Entry storage e = _suppliers[exporter][payout];
        if (e.changeId != 0) revert AlreadyRegistered();
        uint64 activatesAt;
        (changeId, activatesAt) = _newChange(ChangeKind.SUPPLIER, exporter, payout, 0);
        // changeCount is incremented by one per queued change: it never reaches 2**192.
        // forge-lint: disable-next-line(unsafe-typecast)
        e.changeId = uint192(changeId);
        e.activatesAt = activatesAt;
    }

    /// @notice Queues a trusted third party with one or more roles (CARRIER, ARBITER, VERIFIER).
    /// Reverts if any of those roles is already active or pending for that address.
    function queueThirdParty(address party, uint8 roles_) external onlySafe returns (uint256 changeId) {
        if (party == address(0)) revert ZeroAddress();
        _checkRoles(roles_);
        for (uint8 bit = 1; bit <= VERIFIER; bit <<= 1) {
            // Three iterations at most (one per role bit); reverting inside is the intended check.
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (roles_ & bit != 0 && _parties[party][bit].changeId != 0) revert AlreadyRegistered();
        }
        uint64 activatesAt;
        (changeId, activatesAt) = _newChange(ChangeKind.THIRD_PARTY, party, address(0), roles_);
        for (uint8 bit = 1; bit <= VERIFIER; bit <<= 1) {
            // Same bound as in queueSupplier: the counter never reaches 2**192.
            // forge-lint: disable-next-line(unsafe-typecast)
            if (roles_ & bit != 0) _parties[party][bit] = Entry(uint192(changeId), activatesAt);
        }
    }

    /// @notice Vetoes one pending change. The cosigner can only take away, never add.
    /// Other queued changes are not affected.
    function vetoPending(uint256 changeId) external onlySafeOrCosigner {
        Change storage c = changes[changeId];
        // forge-lint: disable-next-line(block-timestamp)
        if (c.kind == ChangeKind.NONE || c.vetoed || block.timestamp >= c.activatesAt) revert ChangeNotPending();
        bool cleared = false;
        if (c.kind == ChangeKind.SUPPLIER) {
            Entry storage e = _suppliers[c.subject][c.payout];
            if (e.changeId == changeId) {
                delete _suppliers[c.subject][c.payout];
                cleared = true;
            }
        } else {
            for (uint8 bit = 1; bit <= VERIFIER; bit <<= 1) {
                if (c.roles & bit != 0 && _parties[c.subject][bit].changeId == changeId) {
                    delete _parties[c.subject][bit];
                    cleared = true;
                }
            }
        }
        // Everything the change added was already removed by the Safe
        if (!cleared) revert ChangeNotPending();
        c.vetoed = true;
        emit ChangeVetoed(changeId, msg.sender);
    }

    /// @notice Removes a supplier pair, active or pending, immediately (removing is the safe
    /// direction).
    function removeSupplier(address exporter, address payout) external onlySafe {
        if (_suppliers[exporter][payout].changeId == 0) revert NotRegistered();
        delete _suppliers[exporter][payout];
        emit SupplierRemoved(exporter, payout);
    }

    /// @notice Removes the given roles of a third party, active or pending, immediately.
    /// Emits the roles actually removed.
    function removeThirdParty(address party, uint8 roles_) external onlySafe {
        _checkRoles(roles_);
        uint8 removed = 0;
        for (uint8 bit = 1; bit <= VERIFIER; bit <<= 1) {
            if (roles_ & bit != 0 && _parties[party][bit].changeId != 0) {
                delete _parties[party][bit];
                removed |= bit;
            }
        }
        if (removed == 0) revert NotRegistered();
        emit ThirdPartyRemoved(party, removed);
    }

    /// @notice Panic button the cosigner can call directly (or the Safe). Only pauses: resuming
    /// is `unpause`, Safe only.
    function emergencyPause() external onlySafeOrCosigner {
        paused = true;
        emit GatePaused(msg.sender);
    }

    // ================================================================== views

    /// @notice True if (exporter, payout) is an active supplier. Pending changes do not count.
    function isKnownSupplier(address exporter, address payout) public view returns (bool) {
        return _active(_suppliers[exporter][payout]);
    }

    /// @notice True if `party` is active with `role` (exactly one of CARRIER, ARBITER, VERIFIER).
    function hasRole(address party, uint8 role) external view returns (bool) {
        if (role != CARRIER && role != ARBITER && role != VERIFIER) revert InvalidRoles();
        return _hasRole(party, role);
    }

    /// @notice The calldata the gate executes for `intent` and the hash the PDR must carry:
    /// keccak256(abi.encode(approveData, fundData)). For parity with the engine (Area 2).
    function fundingCalldataOf(FundIntent calldata intent)
        external
        view
        returns (bytes memory approveData, bytes memory fundData, bytes32 calldataHash)
    {
        return _fundingCalldata(intent);
    }

    function intentHashOf(FundIntent calldata intent) external pure returns (bytes32) {
        return KeelHash.hash(intent);
    }

    /// @notice The payment token, read from the escrow at deployment.
    function token() external view returns (IERC20) {
        return _token;
    }

    // ================================================================== internal

    /// @dev Steps c, d and e of `execute`, in this order.
    function _checkOrderAndParties(FundIntent calldata intent) private view {
        // c. this escrow and this token
        if (intent.escrow != address(escrow) || intent.token != address(_token)) revert OrderMismatch();

        // d. exactly the order this Safe signed, still open
        ITradeEscrow.OrderRecord memory o = escrow.orderOf(intent.orderId);
        if (o.state != ITradeEscrow.State.OPEN) revert OrderNotOpen();
        PurchaseOrder memory po = o.po;
        if (o.orderHash != intent.orderHash || po.token != address(_token) || po.totalAmount != intent.amount) {
            revert OrderMismatch();
        }
        if (po.importer != safe) revert NotOwnOrder();

        // e. registries of this Safe: only active entries count
        if (!isKnownSupplier(po.exporter, po.payoutAddress)) revert UnknownSupplier();
        if (
            !_hasRole(po.carrier, CARRIER) || !_hasRole(po.arbiter, ARBITER) || !_hasRole(po.documentVerifier, VERIFIER)
        ) revert UntrustedParty();
    }

    /// @dev Step h: approve, then fund, both through Roles with `shouldRevert = true`, and the
    /// boolean checked too, so the gate does not depend on Roles reverting on its own.
    function _executeFunding(bytes memory approveData, bytes memory fundData, bytes32 roleKey) private {
        if (!roles.execTransactionWithRole(address(_token), 0, approveData, IRoles.Operation.Call, roleKey, true)) {
            revert ExecutionFailed();
        }
        if (!roles.execTransactionWithRole(address(escrow), 0, fundData, IRoles.Operation.Call, roleKey, true)) {
            revert ExecutionFailed();
        }
    }

    function _fundingCalldata(FundIntent calldata intent)
        private
        view
        returns (bytes memory approveData, bytes memory fundData, bytes32 calldataHash)
    {
        approveData = abi.encodeCall(IERC20.approve, (address(escrow), intent.amount));
        fundData = abi.encodeCall(TradeEscrow.fund, (intent.orderId));
        calldataHash = keccak256(abi.encode(approveData, fundData));
    }

    function _newChange(ChangeKind kind, address subject, address payout, uint8 roles_)
        private
        returns (uint256 changeId, uint64 activatesAt)
    {
        changeId = ++changeCount;
        // A uint64 timestamp lasts far beyond any deployment of this contract.
        // forge-lint: disable-next-line(unsafe-typecast)
        activatesAt = uint64(block.timestamp) + configDelay;
        changes[changeId] = Change(kind, subject, payout, roles_, activatesAt, false);
        emit ChangeQueued(changeId, kind, subject, payout, roles_, activatesAt);
    }

    function _hasRole(address party, uint8 role) private view returns (bool) {
        return _active(_parties[party][role]);
    }

    function _active(Entry storage e) private view returns (bool) {
        // Delays are minutes (demo) to days (production); a block producer shifts seconds.
        // forge-lint: disable-next-line(block-timestamp)
        return e.changeId != 0 && block.timestamp >= e.activatesAt;
    }

    function _checkRoles(uint8 roles_) private pure {
        if (roles_ == 0 || roles_ & ~ALL_ROLES != 0) revert InvalidRoles();
    }
}
