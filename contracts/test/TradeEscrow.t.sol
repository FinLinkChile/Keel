// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {TradeEscrow} from "../src/TradeEscrow.sol";
import {ITradeEscrow} from "../src/ITradeEscrow.sol";
import {KeelHash} from "../src/KeelHash.sol";
import {
    PurchaseOrder,
    ShipmentAttestation,
    CancelOrder,
    BalanceApproval,
    DisputeResolution,
    DocumentDecision
} from "../src/KeelTypes.sol";
import {MockUSDC} from "./mocks/Mocks.sol";
import {FeeOnTransferToken, ReentrantToken, MockSafe1271, ZeroRevertToken} from "./mocks/TradeMocks.sol";

/// @notice Unit tests of TradeEscrow (T1.9): one happy path per function and one negative
/// test per error, plus the escrow cases of T1.7. Digests are built with KeelHash and the
/// expected domain, independently of the contract, so a domain mismatch fails here.
/// Note for writers: vm.expectRevert applies to the next external call, so any value read
/// from the escrow (orderOf, cancelNonceOf) is computed before expectRevert.
contract TradeEscrowTest is Test {
    uint256 constant TOTAL = 10_000e6;
    uint16 constant ADVANCE_BPS = 3000;
    uint256 constant ADVANCE = (TOTAL * ADVANCE_BPS) / 10_000;
    uint256 constant BALANCE = TOTAL - ADVANCE;
    uint64 constant WINDOW = 7 days;
    uint64 constant GRACE = 1 days;
    uint64 constant TO_DEADLINE = 30 days;

    uint256 importerPk = 0x1111;
    uint256 exporterPk = 0x2222;
    uint256 carrierPk = 0x3333;
    uint256 arbiterPk = 0x4444;
    uint256 docPk = 0x5555;
    uint256 carrier2Pk = 0x6666;
    uint256 attackerPk = 0xBAD;

    address importer;
    address exporter;
    address carrier;
    address arbiter;
    address verifier;
    address carrier2;
    address attacker;
    address payout = makeAddr("payout");
    address relayer = makeAddr("relayer");

    MockUSDC usdc;
    TradeEscrow escrow;

    uint256 nextNonce = 1;

    function setUp() public {
        vm.warp(1_760_000_000);
        importer = vm.addr(importerPk);
        exporter = vm.addr(exporterPk);
        carrier = vm.addr(carrierPk);
        arbiter = vm.addr(arbiterPk);
        verifier = vm.addr(docPk);
        carrier2 = vm.addr(carrier2Pk);
        attacker = vm.addr(attackerPk);

        usdc = new MockUSDC();
        escrow = new TradeEscrow(IERC20(address(usdc)), GRACE);
        usdc.mint(importer, 1_000_000e6);
    }

    // ================================================================== helpers

    function _poFor(address imp, address exp, address token) internal returns (PurchaseOrder memory po) {
        uint256 n = nextNonce++;
        po = PurchaseOrder({
            orderId: keccak256(abi.encode(imp, exp, n)),
            importer: imp,
            exporter: exp,
            payoutAddress: payout,
            token: token,
            totalAmount: TOTAL,
            advanceBps: ADVANCE_BPS,
            shipmentDeadline: uint64(vm.getBlockTimestamp() + TO_DEADLINE),
            disputeWindow: WINDOW,
            carrier: carrier,
            arbiter: arbiter,
            documentVerifier: verifier,
            incoterm: bytes32("CIF"),
            termsHash: keccak256("terms"),
            requiredDocsHash: keccak256("BL+invoice"),
            nonce: n
        });
    }

    function _po() internal returns (PurchaseOrder memory) {
        return _poFor(importer, exporter, address(usdc));
    }

    function _rederive(PurchaseOrder memory po) internal pure {
        po.orderId = keccak256(abi.encode(po.importer, po.exporter, po.nonce));
    }

    function _digest(address verifying, bytes32 structHash) internal view returns (bytes32) {
        return KeelHash.digest(KeelHash.domainSeparator(block.chainid, verifying), structHash);
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signPo(uint256 pk, address on, PurchaseOrder memory po) internal view returns (bytes memory) {
        return _sign(pk, _digest(on, KeelHash.hash(po)));
    }

    function _openOn(TradeEscrow e, PurchaseOrder memory po) internal {
        e.open(po, _signPo(importerPk, address(e), po), _signPo(exporterPk, address(e), po));
    }

    function _open(PurchaseOrder memory po) internal {
        _openOn(escrow, po);
    }

    function _fund(PurchaseOrder memory po) internal {
        vm.startPrank(po.importer);
        usdc.approve(address(escrow), po.totalAmount);
        escrow.fund(po.orderId);
        vm.stopPrank();
    }

    function _att(bytes32 orderId, address carrier_, string memory blNumber)
        internal
        view
        returns (ShipmentAttestation memory)
    {
        return ShipmentAttestation({
            orderId: orderId,
            blNumberHash: keccak256(abi.encode(carrier_, blNumber)),
            onBoardDate: uint64(vm.getBlockTimestamp()),
            portOfLoading: bytes32("CNSZX"),
            docsHash: keccak256(abi.encode("docs", orderId))
        });
    }

    function _att(bytes32 orderId) internal view returns (ShipmentAttestation memory) {
        return _att(orderId, carrier, vm.toString(orderId));
    }

    function _signAtt(uint256 pk, ShipmentAttestation memory att) internal view returns (bytes memory) {
        return _sign(pk, _digest(address(escrow), KeelHash.hash(att)));
    }

    function _ship(bytes32 id) internal {
        ShipmentAttestation memory att = _att(id);
        escrow.submitShipment(id, att, _signAtt(carrierPk, att));
    }

    function _decision(bytes32 id) internal view returns (DocumentDecision memory d) {
        ITradeEscrow.OrderRecord memory rec = escrow.orderOf(id);
        d = DocumentDecision({
            orderId: id,
            attestationHash: rec.attestationHash,
            docsHash: rec.docsHash,
            policyHash: keccak256("policy-v1"),
            inputsHash: keccak256("bl+invoice extractions"),
            expiresAt: uint64(vm.getBlockTimestamp() + 1 hours)
        });
    }

    function _signDoc(uint256 pk, address on, DocumentDecision memory d) internal view returns (bytes memory) {
        return _sign(pk, _digest(on, KeelHash.hash(d)));
    }

    function _signCancel(uint256 pk, bytes32 id, uint256 nonce) internal view returns (bytes memory) {
        return _sign(pk, _digest(address(escrow), KeelHash.hash(CancelOrder({orderId: id, nonce: nonce}))));
    }

    function _signRes(uint256 pk, bytes32 id, uint256 toImp, uint256 toExp) internal view returns (bytes memory) {
        return _sign(
            pk,
            _digest(
                address(escrow), KeelHash.hash(DisputeResolution({orderId: id, toImporter: toImp, toExporter: toExp}))
            )
        );
    }

    function _version(bytes32 id) internal view returns (uint256) {
        return escrow.orderOf(id).stateVersion;
    }

    function _cancelNonce(bytes32 id) internal view returns (uint256) {
        return escrow.cancelNonceOf(id);
    }

    function _nonceFor(uint256 version, ITradeEscrow.State state) internal pure returns (uint256) {
        return (version << 8) | uint256(uint8(state));
    }

    function _cancel(PurchaseOrder memory po) internal {
        uint256 n = _cancelNonce(po.orderId);
        escrow.cancel(po.orderId, _signCancel(importerPk, po.orderId, n), _signCancel(exporterPk, po.orderId, n));
    }

    function _signApproval(uint256 pk, address on, bytes32 id, bytes32 attestationHash)
        internal
        view
        returns (bytes memory)
    {
        return _sign(pk, _digest(on, KeelHash.hash(BalanceApproval({orderId: id, attestationHash: attestationHash}))));
    }

    function _approve(bytes32 id) internal {
        escrow.approveBalance(id, _signApproval(importerPk, address(escrow), id, escrow.orderOf(id).attestationHash));
    }

    /// Releases the balance with the verifier's decision, after the dispute window.
    function _release(bytes32 id) internal {
        ITradeEscrow.OrderRecord memory rec = escrow.orderOf(id);
        if (vm.getBlockTimestamp() < rec.shippedAt + rec.po.disputeWindow) {
            vm.warp(rec.shippedAt + rec.po.disputeWindow);
        }
        DocumentDecision memory d = _decision(id);
        escrow.releaseBalance(id, d, _signDoc(docPk, address(escrow), d));
    }

    // ---- reach a state

    function _opened() internal returns (PurchaseOrder memory po) {
        po = _po();
        _open(po);
    }

    /// OPEN -> ADVANCE_PAID: the deposit and the advance happen together in fund.
    function _advancePaid() internal returns (PurchaseOrder memory po) {
        po = _opened();
        _fund(po);
    }

    function _shipped() internal returns (PurchaseOrder memory po) {
        po = _advancePaid();
        _ship(po.orderId);
    }

    function _shippedPastWindow() internal returns (PurchaseOrder memory po) {
        po = _shipped();
        vm.warp(vm.getBlockTimestamp() + WINDOW);
    }

    function _disputed() internal returns (PurchaseOrder memory po) {
        po = _advancePaid();
        vm.prank(importer);
        escrow.raiseDispute(po.orderId);
    }

    function _state(bytes32 id) internal view returns (ITradeEscrow.State) {
        return escrow.orderOf(id).state;
    }

    // ================================================================== constructor

    function test_revert_ZeroAddress_token() public {
        vm.expectRevert(ITradeEscrow.ZeroAddress.selector);
        new TradeEscrow(IERC20(address(0)), GRACE);
    }

    // ================================================================== open

    function test_open_storesOrderAndEmits() public {
        PurchaseOrder memory po = _po();
        bytes32 orderHash = KeelHash.hash(po);
        bytes memory sigI = _signPo(importerPk, address(escrow), po);
        bytes memory sigE = _signPo(exporterPk, address(escrow), po);

        vm.expectEmit(address(escrow));
        emit ITradeEscrow.OrderOpened(po.orderId, orderHash, importer, exporter, payout, TOTAL);
        vm.prank(relayer); // anyone can submit the signed order
        bytes32 returned = escrow.open(po, sigI, sigE);

        assertEq(returned, orderHash);
        ITradeEscrow.OrderRecord memory rec = escrow.orderOf(po.orderId);
        assertEq(uint8(rec.state), uint8(ITradeEscrow.State.OPEN));
        assertEq(rec.stateVersion, 1);
        assertEq(rec.orderHash, orderHash);
        assertEq(rec.po.payoutAddress, payout);
        assertEq(rec.po.documentVerifier, verifier);
        assertEq(rec.po.nonce, po.nonce);
        assertEq(rec.paidOut, 0);
        assertFalse(rec.funded);
    }

    function test_revert_BadOrderId_notDerived() public {
        PurchaseOrder memory po = _po();
        po.orderId = keccak256("free-form id");
        vm.expectRevert(ITradeEscrow.BadOrderId.selector);
        escrow.open(po, _signPo(importerPk, address(escrow), po), _signPo(exporterPk, address(escrow), po));
    }

    /// C2: an attacker cannot squat the orderId of a legitimate order with its own parties.
    function test_revert_BadOrderId_squatVictimId() public {
        PurchaseOrder memory victim = _po();
        PurchaseOrder memory squat = _poFor(attacker, vm.addr(0xBEEF), address(usdc));
        squat.orderId = victim.orderId;
        vm.expectRevert(ITradeEscrow.BadOrderId.selector);
        escrow.open(squat, _signPo(attackerPk, address(escrow), squat), _signPo(0xBEEF, address(escrow), squat));
        // The legitimate order still opens.
        _open(victim);
        assertEq(uint8(_state(victim.orderId)), uint8(ITradeEscrow.State.OPEN));
    }

    function test_revert_OrderExists_reopen() public {
        PurchaseOrder memory po = _opened();
        vm.expectRevert(ITradeEscrow.OrderExists.selector);
        _open(po);
    }

    function test_revert_OrderExists_reopenCancelledWithSameSignatures() public {
        PurchaseOrder memory po = _po();
        bytes memory sigI = _signPo(importerPk, address(escrow), po);
        bytes memory sigE = _signPo(exporterPk, address(escrow), po);
        escrow.open(po, sigI, sigE);
        _cancel(po);
        vm.expectRevert(ITradeEscrow.OrderExists.selector);
        escrow.open(po, sigI, sigE);
    }

    function test_revert_TokenNotAllowed_otherToken() public {
        PurchaseOrder memory po = _poFor(importer, exporter, address(new MockUSDC()));
        vm.expectRevert(ITradeEscrow.TokenNotAllowed.selector);
        _open(po);
    }

    function _expectInvalidOrder(PurchaseOrder memory po) internal {
        _rederive(po);
        vm.expectRevert(ITradeEscrow.InvalidOrder.selector);
        escrow.open(po, _signPo(importerPk, address(escrow), po), _signPo(exporterPk, address(escrow), po));
    }

    function test_revert_InvalidOrder_zeroImporter() public {
        PurchaseOrder memory po = _po();
        po.importer = address(0);
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_zeroExporter() public {
        PurchaseOrder memory po = _po();
        po.exporter = address(0);
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_zeroPayout() public {
        PurchaseOrder memory po = _po();
        po.payoutAddress = address(0);
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_zeroCarrier() public {
        PurchaseOrder memory po = _po();
        po.carrier = address(0);
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_zeroArbiter() public {
        PurchaseOrder memory po = _po();
        po.arbiter = address(0);
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_zeroVerifier() public {
        PurchaseOrder memory po = _po();
        po.documentVerifier = address(0);
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_importerIsExporter() public {
        PurchaseOrder memory po = _po();
        po.exporter = importer;
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_carrierIsImporter() public {
        PurchaseOrder memory po = _po();
        po.carrier = importer;
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_carrierIsExporter() public {
        PurchaseOrder memory po = _po();
        po.carrier = exporter;
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_carrierIsPayout() public {
        PurchaseOrder memory po = _po();
        po.carrier = payout;
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_arbiterIsImporter() public {
        PurchaseOrder memory po = _po();
        po.arbiter = importer;
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_arbiterIsExporter() public {
        PurchaseOrder memory po = _po();
        po.arbiter = exporter;
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_arbiterIsPayout() public {
        PurchaseOrder memory po = _po();
        po.arbiter = payout;
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_verifierIsImporter() public {
        PurchaseOrder memory po = _po();
        po.documentVerifier = importer;
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_verifierIsExporter() public {
        PurchaseOrder memory po = _po();
        po.documentVerifier = exporter;
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_verifierIsCarrier() public {
        PurchaseOrder memory po = _po();
        po.documentVerifier = carrier;
        _expectInvalidOrder(po);
    }

    /// The exporter cannot be its own verifier through the payout address it controls.
    function test_revert_InvalidOrder_verifierIsPayout() public {
        PurchaseOrder memory po = _po();
        po.documentVerifier = payout;
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_verifierIsArbiter() public {
        PurchaseOrder memory po = _po();
        po.documentVerifier = arbiter;
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_advanceOver100Percent() public {
        PurchaseOrder memory po = _po();
        po.advanceBps = 10_001;
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_zeroTotal() public {
        PurchaseOrder memory po = _po();
        po.totalAmount = 0;
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_deadlineNotInFuture() public {
        PurchaseOrder memory po = _po();
        po.shipmentDeadline = uint64(vm.getBlockTimestamp());
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_importerIsEscrow() public {
        PurchaseOrder memory po = _po();
        po.importer = address(escrow);
        _expectInvalidOrder(po);
    }

    function test_revert_InvalidOrder_payoutIsEscrow() public {
        PurchaseOrder memory po = _po();
        po.payoutAddress = address(escrow);
        _expectInvalidOrder(po);
    }

    function test_revert_BadImporterSignature_wrongKey() public {
        PurchaseOrder memory po = _po();
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.open(po, _signPo(attackerPk, address(escrow), po), _signPo(exporterPk, address(escrow), po));
    }

    /// Account change fraud: the payout address is swapped after both parties signed.
    function test_revert_BadImporterSignature_payoutSwappedAfterSigning() public {
        PurchaseOrder memory po = _po();
        bytes memory sigI = _signPo(importerPk, address(escrow), po);
        bytes memory sigE = _signPo(exporterPk, address(escrow), po);
        po.payoutAddress = attacker;
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.open(po, sigI, sigE);
    }

    function test_revert_BadImporterSignature_otherEscrowDomain() public {
        PurchaseOrder memory po = _po();
        address otherEscrow = makeAddr("otherEscrow");
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.open(po, _signPo(importerPk, otherEscrow, po), _signPo(exporterPk, otherEscrow, po));
    }

    function test_revert_BadExporterSignature_wrongKey() public {
        PurchaseOrder memory po = _po();
        vm.expectRevert(ITradeEscrow.BadExporterSignature.selector);
        escrow.open(po, _signPo(importerPk, address(escrow), po), _signPo(attackerPk, address(escrow), po));
    }

    function test_revert_BadImporterSignature_safe1271Rejects() public {
        MockSafe1271 safe = new MockSafe1271(importer);
        PurchaseOrder memory po = _poFor(address(safe), exporter, address(usdc));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerPk, _digest(address(escrow), KeelHash.hash(po)));
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.open(po, abi.encode(r, s, v), _signPo(exporterPk, address(escrow), po));
    }

    function test_safe1271_exporterSigns() public {
        MockSafe1271 exporterSafe = new MockSafe1271(exporter);
        PurchaseOrder memory po = _poFor(importer, address(exporterSafe), address(usdc));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(exporterPk, _digest(address(escrow), KeelHash.hash(po)));
        escrow.open(po, _signPo(importerPk, address(escrow), po), abi.encode(r, s, v));
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.OPEN));

        PurchaseOrder memory po2 = _poFor(importer, address(exporterSafe), address(usdc));
        (v, r, s) = vm.sign(attackerPk, _digest(address(escrow), KeelHash.hash(po2)));
        vm.expectRevert(ITradeEscrow.BadExporterSignature.selector);
        escrow.open(po2, _signPo(importerPk, address(escrow), po2), abi.encode(r, s, v));
    }

    // ================================================================== fund (deposit + advance)

    /// Decision 2: one call pulls the total, pays the advance and leaves ADVANCE_PAID.
    function test_fund_pullsTotalAndPaysAdvance() public {
        PurchaseOrder memory po = _opened();
        vm.startPrank(importer);
        usdc.approve(address(escrow), TOTAL);
        vm.expectEmit(address(escrow));
        emit ITradeEscrow.OrderFunded(po.orderId, TOTAL);
        vm.expectEmit(address(escrow));
        emit ITradeEscrow.AdvanceReleased(po.orderId, payout, ADVANCE);
        escrow.fund(po.orderId);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(escrow)), BALANCE);
        assertEq(usdc.balanceOf(payout), ADVANCE);
        assertEq(usdc.allowance(importer, address(escrow)), 0);
        ITradeEscrow.OrderRecord memory rec = escrow.orderOf(po.orderId);
        assertEq(uint8(rec.state), uint8(ITradeEscrow.State.ADVANCE_PAID));
        assertEq(rec.paidOut, ADVANCE);
        assertEq(rec.stateVersion, 2);
        assertTrue(rec.funded);
    }

    function test_fund_zeroAdvanceTransfersNothingOut() public {
        PurchaseOrder memory po = _po();
        po.advanceBps = 0;
        _open(po);
        vm.startPrank(importer);
        usdc.approve(address(escrow), TOTAL);
        vm.expectEmit(address(escrow));
        emit ITradeEscrow.OrderFunded(po.orderId, TOTAL);
        vm.expectEmit(address(escrow));
        emit ITradeEscrow.AdvanceReleased(po.orderId, payout, 0);
        escrow.fund(po.orderId);
        vm.stopPrank();
        assertEq(usdc.balanceOf(payout), 0);
        assertEq(usdc.balanceOf(address(escrow)), TOTAL);
        assertEq(escrow.orderOf(po.orderId).paidOut, 0);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.ADVANCE_PAID));
    }

    function test_fund_lastSecondBeforeDeadline() public {
        PurchaseOrder memory po = _opened();
        vm.warp(po.shipmentDeadline - 1);
        _fund(po);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.ADVANCE_PAID));
    }

    function test_revert_NotParty_fundByStranger() public {
        PurchaseOrder memory po = _opened();
        usdc.mint(attacker, TOTAL);
        vm.startPrank(attacker);
        usdc.approve(address(escrow), TOTAL);
        vm.expectRevert(ITradeEscrow.NotParty.selector);
        escrow.fund(po.orderId);
        vm.stopPrank();
    }

    function test_revert_NotParty_fundByExporter() public {
        PurchaseOrder memory po = _opened();
        vm.expectRevert(ITradeEscrow.NotParty.selector);
        vm.prank(exporter);
        escrow.fund(po.orderId);
    }

    /// A short deposit reverts before any advance leaves the escrow.
    function test_revert_AmountMismatch_feeOnTransferToken() public {
        FeeOnTransferToken fee = new FeeOnTransferToken();
        TradeEscrow feeEscrow = new TradeEscrow(IERC20(address(fee)), GRACE);
        PurchaseOrder memory po = _poFor(importer, exporter, address(fee));
        _openOn(feeEscrow, po);
        fee.mint(importer, TOTAL);
        vm.startPrank(importer);
        fee.approve(address(feeEscrow), TOTAL);
        vm.expectRevert(ITradeEscrow.AmountMismatch.selector);
        feeEscrow.fund(po.orderId);
        vm.stopPrank();
        assertEq(fee.balanceOf(payout), 0);
    }

    function test_revert_InvalidState_fundTwice() public {
        PurchaseOrder memory po = _advancePaid();
        vm.startPrank(importer);
        usdc.approve(address(escrow), TOTAL);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.fund(po.orderId);
        vm.stopPrank();
    }

    function test_revert_InvalidState_fundUnknownOrder() public {
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        vm.prank(importer);
        escrow.fund(keccak256("unknown"));
    }

    function test_revert_DeadlinePassed_fundAtDeadline() public {
        PurchaseOrder memory po = _opened();
        vm.warp(po.shipmentDeadline);
        vm.startPrank(importer);
        usdc.approve(address(escrow), TOTAL);
        vm.expectRevert(ITradeEscrow.DeadlinePassed.selector);
        escrow.fund(po.orderId);
        vm.stopPrank();
    }

    // ================================================================== submitShipment

    function test_submitShipment_marksShipped() public {
        PurchaseOrder memory po = _advancePaid();
        ShipmentAttestation memory att = _att(po.orderId);
        bytes32 attHash = KeelHash.hash(att);
        bytes32 blKey = keccak256(abi.encode(carrier, att.blNumberHash));

        vm.expectEmit(address(escrow));
        emit ITradeEscrow.ShipmentAccepted(po.orderId, attHash, blKey, att.onBoardDate);
        vm.prank(relayer);
        escrow.submitShipment(po.orderId, att, _signAtt(carrierPk, att));

        ITradeEscrow.OrderRecord memory rec = escrow.orderOf(po.orderId);
        assertEq(uint8(rec.state), uint8(ITradeEscrow.State.SHIPPED));
        assertEq(rec.attestationHash, attHash);
        assertEq(rec.docsHash, att.docsHash);
        assertEq(rec.shippedAt, vm.getBlockTimestamp());
        assertTrue(escrow.isBlUsed(blKey));
        // No money moves on shipment (C1).
        assertEq(usdc.balanceOf(address(escrow)), BALANCE);
    }

    /// An on-time on board date is accepted after the deadline while nobody has refunded.
    function test_submitShipment_onTimeDateSubmittedLate() public {
        PurchaseOrder memory po = _advancePaid();
        ShipmentAttestation memory att = _att(po.orderId);
        vm.warp(po.shipmentDeadline + 1 hours);
        escrow.submitShipment(po.orderId, att, _signAtt(carrierPk, att));
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.SHIPPED));
    }

    function test_submitShipment_onBoardExactlyAtDeadline() public {
        PurchaseOrder memory po = _advancePaid();
        vm.warp(po.shipmentDeadline);
        ShipmentAttestation memory att = _att(po.orderId);
        assertEq(att.onBoardDate, po.shipmentDeadline);
        escrow.submitShipment(po.orderId, att, _signAtt(carrierPk, att));
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.SHIPPED));
    }

    function test_revert_BadCarrierSignature_otherKey() public {
        PurchaseOrder memory po = _advancePaid();
        ShipmentAttestation memory att = _att(po.orderId);
        vm.expectRevert(ITradeEscrow.BadCarrierSignature.selector);
        escrow.submitShipment(po.orderId, att, _signAtt(attackerPk, att));
    }

    /// The exporter cannot certify its own shipment.
    function test_revert_BadCarrierSignature_signedByExporter() public {
        PurchaseOrder memory po = _advancePaid();
        ShipmentAttestation memory att = _att(po.orderId);
        vm.expectRevert(ITradeEscrow.BadCarrierSignature.selector);
        escrow.submitShipment(po.orderId, att, _signAtt(exporterPk, att));
    }

    function test_revert_InvalidAttestation_otherOrder() public {
        PurchaseOrder memory a = _advancePaid();
        PurchaseOrder memory b = _advancePaid();
        ShipmentAttestation memory attB = _att(b.orderId);
        bytes memory sig = _signAtt(carrierPk, attB);
        vm.expectRevert(ITradeEscrow.InvalidAttestation.selector);
        escrow.submitShipment(a.orderId, attB, sig);
    }

    function test_revert_ShipmentTooLate_onBoardAfterDeadline() public {
        PurchaseOrder memory po = _advancePaid();
        vm.warp(po.shipmentDeadline + 1);
        ShipmentAttestation memory att = _att(po.orderId);
        att.onBoardDate = po.shipmentDeadline + 1;
        vm.expectRevert(ITradeEscrow.ShipmentTooLate.selector);
        escrow.submitShipment(po.orderId, att, _signAtt(carrierPk, att));
    }

    function test_revert_InvalidAttestation_onBoardInFuture() public {
        PurchaseOrder memory po = _advancePaid();
        ShipmentAttestation memory att = _att(po.orderId);
        att.onBoardDate = uint64(vm.getBlockTimestamp() + 1);
        vm.expectRevert(ITradeEscrow.InvalidAttestation.selector);
        escrow.submitShipment(po.orderId, att, _signAtt(carrierPk, att));
    }

    function test_revert_BillOfLadingAlreadyUsed_sameCarrierTwoOrders() public {
        PurchaseOrder memory a = _advancePaid();
        PurchaseOrder memory b = _advancePaid();
        ShipmentAttestation memory attA = _att(a.orderId, carrier, "BL-001");
        escrow.submitShipment(a.orderId, attA, _signAtt(carrierPk, attA));

        ShipmentAttestation memory attB = _att(b.orderId, carrier, "BL-001");
        vm.expectRevert(ITradeEscrow.BillOfLadingAlreadyUsed.selector);
        escrow.submitShipment(b.orderId, attB, _signAtt(carrierPk, attB));
    }

    /// C4: the used-BL key is scoped to the carrier of the order, so a carrier cannot burn
    /// the BL hash of another carrier.
    function test_submitShipment_sameBlHashDifferentCarriersDoNotCollide() public {
        PurchaseOrder memory a = _advancePaid();
        PurchaseOrder memory b = _po();
        b.carrier = carrier2;
        _open(b);
        _fund(b);

        bytes32 sharedHash = keccak256(abi.encode(carrier, "BL-001"));
        ShipmentAttestation memory attB = _att(b.orderId);
        attB.blNumberHash = sharedHash; // carrier2 front-runs with carrier 1's hash
        escrow.submitShipment(b.orderId, attB, _signAtt(carrier2Pk, attB));

        ShipmentAttestation memory attA = _att(a.orderId);
        attA.blNumberHash = sharedHash;
        escrow.submitShipment(a.orderId, attA, _signAtt(carrierPk, attA));
        assertEq(uint8(_state(a.orderId)), uint8(ITradeEscrow.State.SHIPPED));
        assertEq(uint8(_state(b.orderId)), uint8(ITradeEscrow.State.SHIPPED));
    }

    function test_revert_InvalidState_shipmentWhileDisputed() public {
        PurchaseOrder memory po = _disputed();
        ShipmentAttestation memory att = _att(po.orderId);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.submitShipment(po.orderId, att, _signAtt(carrierPk, att));
    }

    function test_revert_InvalidState_shipmentBeforeFunding() public {
        PurchaseOrder memory po = _opened();
        ShipmentAttestation memory att = _att(po.orderId);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.submitShipment(po.orderId, att, _signAtt(carrierPk, att));
    }

    // ================================================================== releaseBalance

    function test_releaseBalance_paysBalanceAfterWindow() public {
        PurchaseOrder memory po = _shippedPastWindow();
        DocumentDecision memory d = _decision(po.orderId);
        bytes32 decisionDigest = _digest(address(escrow), KeelHash.hash(d));

        vm.expectEmit(address(escrow));
        emit ITradeEscrow.BalanceReleased(po.orderId, payout, BALANCE, decisionDigest);
        vm.prank(relayer);
        escrow.releaseBalance(po.orderId, d, _signDoc(docPk, address(escrow), d));

        assertEq(usdc.balanceOf(payout), TOTAL);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.orderOf(po.orderId).paidOut, TOTAL);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.SETTLED));
    }

    /// The decision does not speed the payment up: it only runs once the window closed.
    function test_revert_DeadlineNotReached_releaseBalanceInsideWindow() public {
        PurchaseOrder memory po = _shipped();
        vm.warp(vm.getBlockTimestamp() + WINDOW - 1);
        DocumentDecision memory d = _decision(po.orderId);
        vm.expectRevert(ITradeEscrow.DeadlineNotReached.selector);
        escrow.releaseBalance(po.orderId, d, _signDoc(docPk, address(escrow), d));
    }

    /// C5: with a zero dispute window the verifier's decision can run right after the shipment.
    function test_releaseBalance_zeroWindowIsImmediate() public {
        PurchaseOrder memory po = _po();
        po.disputeWindow = 0;
        _open(po);
        _fund(po);
        _ship(po.orderId);
        DocumentDecision memory d = _decision(po.orderId);
        escrow.releaseBalance(po.orderId, d, _signDoc(docPk, address(escrow), d));
        assertEq(usdc.balanceOf(payout), TOTAL);
    }

    function test_releaseBalance_acceptedAtExpiry() public {
        PurchaseOrder memory po = _shippedPastWindow();
        DocumentDecision memory d = _decision(po.orderId);
        bytes memory sig = _signDoc(docPk, address(escrow), d);
        vm.warp(d.expiresAt);
        escrow.releaseBalance(po.orderId, d, sig);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.SETTLED));
    }

    /// The document verifier can be a contract wallet that signs with ERC-1271.
    function test_releaseBalance_verifierIsSafe1271() public {
        MockSafe1271 verifierSafe = new MockSafe1271(verifier);
        PurchaseOrder memory po = _po();
        po.documentVerifier = address(verifierSafe);
        _open(po);
        _fund(po);
        _ship(po.orderId);
        vm.warp(vm.getBlockTimestamp() + WINDOW);
        DocumentDecision memory d = _decision(po.orderId);
        bytes32 digest = _digest(address(escrow), KeelHash.hash(d));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerPk, digest);
        vm.expectRevert(ITradeEscrow.BadDocumentDecision.selector);
        escrow.releaseBalance(po.orderId, d, abi.encode(r, s, v));

        (v, r, s) = vm.sign(docPk, digest);
        escrow.releaseBalance(po.orderId, d, abi.encode(r, s, v));
        assertEq(usdc.balanceOf(payout), TOTAL);
    }

    function _expectBadDecision(bytes32 id, DocumentDecision memory d, bytes memory sig) internal {
        vm.expectRevert(ITradeEscrow.BadDocumentDecision.selector);
        escrow.releaseBalance(id, d, sig);
    }

    function test_revert_BadDocumentDecision_otherOrder() public {
        PurchaseOrder memory a = _shipped();
        PurchaseOrder memory b = _shippedPastWindow();
        DocumentDecision memory dB = _decision(b.orderId);
        _expectBadDecision(a.orderId, dB, _signDoc(docPk, address(escrow), dB));
    }

    /// Isolates the orderId check: a decision carrying this order's hashes but another
    /// order's id is rejected.
    function test_revert_BadDocumentDecision_orderIdOnlyMismatch() public {
        PurchaseOrder memory a = _shipped();
        PurchaseOrder memory b = _shippedPastWindow();
        DocumentDecision memory d = _decision(a.orderId);
        d.orderId = b.orderId;
        _expectBadDecision(a.orderId, d, _signDoc(docPk, address(escrow), d));
    }

    function test_revert_BadDocumentDecision_wrongAttestationHash() public {
        PurchaseOrder memory po = _shippedPastWindow();
        DocumentDecision memory d = _decision(po.orderId);
        d.attestationHash = keccak256("forged attestation");
        _expectBadDecision(po.orderId, d, _signDoc(docPk, address(escrow), d));
    }

    function test_revert_BadDocumentDecision_wrongDocsHash() public {
        PurchaseOrder memory po = _shippedPastWindow();
        DocumentDecision memory d = _decision(po.orderId);
        d.docsHash = keccak256("other documents");
        _expectBadDecision(po.orderId, d, _signDoc(docPk, address(escrow), d));
    }

    function test_revert_BadDocumentDecision_expired() public {
        PurchaseOrder memory po = _shippedPastWindow();
        DocumentDecision memory d = _decision(po.orderId);
        bytes memory sig = _signDoc(docPk, address(escrow), d);
        vm.warp(d.expiresAt + 1);
        _expectBadDecision(po.orderId, d, sig);
    }

    function test_revert_BadDocumentDecision_wrongSigner() public {
        PurchaseOrder memory po = _shippedPastWindow();
        DocumentDecision memory d = _decision(po.orderId);
        _expectBadDecision(po.orderId, d, _signDoc(attackerPk, address(escrow), d));
    }

    /// The verifier is per order: the verifier named in another order cannot sign for this one.
    function test_revert_BadDocumentDecision_verifierOfOtherOrder() public {
        uint256 otherVerifierPk = 0x7777;
        PurchaseOrder memory b = _po();
        b.documentVerifier = vm.addr(otherVerifierPk);
        _open(b);
        PurchaseOrder memory po = _shippedPastWindow();
        DocumentDecision memory d = _decision(po.orderId);
        _expectBadDecision(po.orderId, d, _signDoc(otherVerifierPk, address(escrow), d));
    }

    /// Neither a party nor the carrier can sign the document decision.
    function test_revert_BadDocumentDecision_signedByImporterOrCarrier() public {
        PurchaseOrder memory po = _shippedPastWindow();
        DocumentDecision memory d = _decision(po.orderId);
        _expectBadDecision(po.orderId, d, _signDoc(importerPk, address(escrow), d));
        _expectBadDecision(po.orderId, d, _signDoc(carrierPk, address(escrow), d));
    }

    function test_revert_BadDocumentDecision_otherEscrowDomain() public {
        PurchaseOrder memory po = _shippedPastWindow();
        DocumentDecision memory d = _decision(po.orderId);
        _expectBadDecision(po.orderId, d, _signDoc(docPk, makeAddr("otherEscrow"), d));
    }

    function test_revert_InvalidState_releaseBalanceBeforeShipment() public {
        PurchaseOrder memory po = _advancePaid();
        DocumentDecision memory d = _decision(po.orderId);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.releaseBalance(po.orderId, d, _signDoc(docPk, address(escrow), d));
    }

    function test_revert_InvalidState_releaseBalanceTwice() public {
        PurchaseOrder memory po = _shippedPastWindow();
        DocumentDecision memory d = _decision(po.orderId);
        bytes memory sig = _signDoc(docPk, address(escrow), d);
        escrow.releaseBalance(po.orderId, d, sig);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.releaseBalance(po.orderId, d, sig);
    }

    function test_revert_InvalidState_releaseBalanceAfterDisputeFromShipped() public {
        PurchaseOrder memory po = _shippedPastWindow();
        DocumentDecision memory d = _decision(po.orderId);
        bytes memory sig = _signDoc(docPk, address(escrow), d);
        bytes memory apprSig =
            _signApproval(importerPk, address(escrow), po.orderId, escrow.orderOf(po.orderId).attestationHash);
        vm.prank(importer);
        escrow.raiseDispute(po.orderId);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.releaseBalance(po.orderId, d, sig);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.approveBalance(po.orderId, apprSig);
    }

    // ================================================================== approveBalance

    /// The importer waives the window and releases the balance right after the shipment.
    function test_approveBalance_paysBalanceImmediately() public {
        PurchaseOrder memory po = _shipped();
        bytes32 attHash = escrow.orderOf(po.orderId).attestationHash;
        bytes32 approvalDigest =
            _digest(address(escrow), KeelHash.hash(BalanceApproval({orderId: po.orderId, attestationHash: attHash})));
        bytes memory sig = _signApproval(importerPk, address(escrow), po.orderId, attHash);

        vm.expectEmit(address(escrow));
        emit ITradeEscrow.BalanceReleased(po.orderId, payout, BALANCE, approvalDigest);
        vm.prank(relayer);
        escrow.approveBalance(po.orderId, sig);

        assertEq(usdc.balanceOf(payout), TOTAL);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.orderOf(po.orderId).paidOut, TOTAL);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.SETTLED));
    }

    function test_revert_BadImporterSignature_approveWrongKey() public {
        PurchaseOrder memory po = _shipped();
        bytes32 attHash = escrow.orderOf(po.orderId).attestationHash;
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.approveBalance(po.orderId, _signApproval(attackerPk, address(escrow), po.orderId, attHash));
    }

    /// The exporter cannot approve its own balance.
    function test_revert_BadImporterSignature_approveSignedByExporter() public {
        PurchaseOrder memory po = _shipped();
        bytes32 attHash = escrow.orderOf(po.orderId).attestationHash;
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.approveBalance(po.orderId, _signApproval(exporterPk, address(escrow), po.orderId, attHash));
    }

    /// The approval is built from the stored attestation: one signed over another
    /// attestation does not release this balance.
    function test_revert_BadImporterSignature_approveOtherAttestation() public {
        PurchaseOrder memory po = _shipped();
        bytes memory sig = _signApproval(importerPk, address(escrow), po.orderId, keccak256("other attestation"));
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.approveBalance(po.orderId, sig);
    }

    function test_revert_BadImporterSignature_approveOfOtherOrder() public {
        PurchaseOrder memory a = _shipped();
        PurchaseOrder memory b = _shipped();
        bytes memory sigB =
            _signApproval(importerPk, address(escrow), b.orderId, escrow.orderOf(b.orderId).attestationHash);
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.approveBalance(a.orderId, sigB);
    }

    function test_revert_BadImporterSignature_approveOtherEscrowDomain() public {
        PurchaseOrder memory po = _shipped();
        bytes32 attHash = escrow.orderOf(po.orderId).attestationHash;
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.approveBalance(po.orderId, _signApproval(importerPk, makeAddr("otherEscrow"), po.orderId, attHash));
    }

    function test_revert_InvalidState_approveBeforeShipment() public {
        PurchaseOrder memory po = _advancePaid();
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.approveBalance(po.orderId, _signApproval(importerPk, address(escrow), po.orderId, bytes32(0)));
    }

    function test_revert_InvalidState_approveTwice() public {
        PurchaseOrder memory po = _shipped();
        bytes memory sig =
            _signApproval(importerPk, address(escrow), po.orderId, escrow.orderOf(po.orderId).attestationHash);
        escrow.approveBalance(po.orderId, sig);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.approveBalance(po.orderId, sig);
    }

    function test_safe1271_importerOpensFundsAndApproves() public {
        MockSafe1271 safe = new MockSafe1271(importer);
        PurchaseOrder memory po = _poFor(address(safe), exporter, address(usdc));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(importerPk, _digest(address(escrow), KeelHash.hash(po)));
        escrow.open(po, abi.encode(r, s, v), _signPo(exporterPk, address(escrow), po));
        usdc.mint(address(safe), TOTAL);
        vm.startPrank(importer);
        safe.exec(address(usdc), abi.encodeCall(IERC20.approve, (address(escrow), TOTAL)));
        safe.exec(address(escrow), abi.encodeCall(ITradeEscrow.fund, (po.orderId)));
        vm.stopPrank();
        assertEq(usdc.balanceOf(payout), ADVANCE);
        _ship(po.orderId);

        bytes32 attHash = escrow.orderOf(po.orderId).attestationHash;
        bytes32 digest =
            _digest(address(escrow), KeelHash.hash(BalanceApproval({orderId: po.orderId, attestationHash: attHash})));
        (v, r, s) = vm.sign(attackerPk, digest);
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.approveBalance(po.orderId, abi.encode(r, s, v));

        (v, r, s) = vm.sign(importerPk, digest);
        escrow.approveBalance(po.orderId, abi.encode(r, s, v));
        assertEq(usdc.balanceOf(payout), TOTAL);
    }

    function test_safe1271_refundGoesBackToSafe() public {
        MockSafe1271 safe = new MockSafe1271(importer);
        PurchaseOrder memory po = _poFor(address(safe), exporter, address(usdc));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(importerPk, _digest(address(escrow), KeelHash.hash(po)));
        escrow.open(po, abi.encode(r, s, v), _signPo(exporterPk, address(escrow), po));
        usdc.mint(address(safe), TOTAL);
        vm.startPrank(importer);
        safe.exec(address(usdc), abi.encodeCall(IERC20.approve, (address(escrow), TOTAL)));
        safe.exec(address(escrow), abi.encodeCall(ITradeEscrow.fund, (po.orderId)));
        vm.stopPrank();

        vm.warp(po.shipmentDeadline + GRACE + 1);
        escrow.refundAfterDeadline(po.orderId);
        assertEq(usdc.balanceOf(address(safe)), BALANCE);
    }

    // ================================================================== refundAfterDeadline

    function test_refund_fromAdvancePaid() public {
        PurchaseOrder memory po = _advancePaid();
        uint256 before = usdc.balanceOf(importer);
        vm.warp(po.shipmentDeadline + GRACE + 1);
        vm.expectEmit(address(escrow));
        emit ITradeEscrow.Refunded(po.orderId, importer, BALANCE);
        vm.prank(relayer);
        escrow.refundAfterDeadline(po.orderId);
        assertEq(usdc.balanceOf(importer) - before, BALANCE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.orderOf(po.orderId).paidOut, TOTAL);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.REFUNDED));
    }

    /// With a 0% advance the whole deposit comes back.
    function test_refund_zeroAdvanceReturnsTotal() public {
        PurchaseOrder memory po = _po();
        po.advanceBps = 0;
        _open(po);
        _fund(po);
        uint256 before = usdc.balanceOf(importer);
        vm.warp(po.shipmentDeadline + GRACE + 1);
        escrow.refundAfterDeadline(po.orderId);
        assertEq(usdc.balanceOf(importer) - before, TOTAL);
    }

    function test_revert_DeadlineNotReached_refundBeforeDeadline() public {
        PurchaseOrder memory po = _advancePaid();
        vm.expectRevert(ITradeEscrow.DeadlineNotReached.selector);
        escrow.refundAfterDeadline(po.orderId);
    }

    function test_revert_DeadlineNotReached_refundAtEndOfGrace() public {
        PurchaseOrder memory po = _advancePaid();
        vm.warp(po.shipmentDeadline + GRACE);
        vm.expectRevert(ITradeEscrow.DeadlineNotReached.selector);
        escrow.refundAfterDeadline(po.orderId);
    }

    /// C1: once the carrier attested an on-time shipment, the deadline cannot claw it back.
    function test_revert_InvalidState_refundAfterShipped() public {
        PurchaseOrder memory po = _shipped();
        vm.warp(po.shipmentDeadline + GRACE + 1);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.refundAfterDeadline(po.orderId);
    }

    function test_revert_InvalidState_refundAfterSettled() public {
        PurchaseOrder memory po = _shipped();
        _release(po.orderId);
        vm.warp(po.shipmentDeadline + GRACE + 1);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.refundAfterDeadline(po.orderId);
    }

    function test_revert_InvalidState_refundFromOpen() public {
        PurchaseOrder memory po = _opened();
        vm.warp(po.shipmentDeadline + GRACE + 1);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.refundAfterDeadline(po.orderId);
    }

    // ================================================================== raiseDispute

    function test_raiseDispute_fromAdvancePaidByExporter() public {
        PurchaseOrder memory po = _advancePaid();
        vm.expectEmit(address(escrow));
        emit ITradeEscrow.DisputeRaised(po.orderId, exporter);
        vm.prank(exporter);
        escrow.raiseDispute(po.orderId);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.DISPUTED));
    }

    function test_raiseDispute_fromAdvancePaidByImporter() public {
        PurchaseOrder memory po = _disputed();
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.DISPUTED));
    }

    function test_raiseDispute_fromShippedInsideWindow() public {
        PurchaseOrder memory po = _shipped();
        vm.warp(vm.getBlockTimestamp() + WINDOW - 1);
        vm.prank(importer);
        escrow.raiseDispute(po.orderId);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.DISPUTED));
    }

    /// C1: in SHIPPED either party can dispute with no time limit.
    function test_raiseDispute_fromShippedLongAfterWindow() public {
        PurchaseOrder memory po = _shipped();
        vm.warp(vm.getBlockTimestamp() + WINDOW + 365 days);
        vm.prank(importer);
        escrow.raiseDispute(po.orderId);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.DISPUTED));
    }

    function test_raiseDispute_fromShippedWithZeroWindow() public {
        PurchaseOrder memory po = _po();
        po.disputeWindow = 0;
        _open(po);
        _fund(po);
        _ship(po.orderId);
        vm.prank(exporter);
        escrow.raiseDispute(po.orderId);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.DISPUTED));
    }

    /// Liquidity: the verifier never signs and the importer never approves. The exporter
    /// disputes long after the window and the arbiter releases the balance, so the balance of
    /// a shipped order is never trapped by a single missing signer.
    function test_liquidity_verifierDownImporterSilent_exporterDisputes() public {
        PurchaseOrder memory po = _shipped();
        vm.warp(vm.getBlockTimestamp() + WINDOW + 90 days);
        vm.prank(exporter);
        escrow.raiseDispute(po.orderId);
        escrow.resolve(po.orderId, 0, BALANCE, _signRes(arbiterPk, po.orderId, 0, BALANCE));
        assertEq(usdc.balanceOf(payout), TOTAL);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.RESOLVED));
    }

    function test_revert_NotParty_disputeByStranger() public {
        PurchaseOrder memory po = _advancePaid();
        vm.expectRevert(ITradeEscrow.NotParty.selector);
        vm.prank(attacker);
        escrow.raiseDispute(po.orderId);
    }

    function test_revert_NotParty_disputeByCarrierOrArbiter() public {
        PurchaseOrder memory po = _advancePaid();
        vm.expectRevert(ITradeEscrow.NotParty.selector);
        vm.prank(carrier);
        escrow.raiseDispute(po.orderId);
        vm.expectRevert(ITradeEscrow.NotParty.selector);
        vm.prank(arbiter);
        escrow.raiseDispute(po.orderId);
    }

    function test_revert_InvalidState_disputeFromOpen() public {
        PurchaseOrder memory po = _opened();
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        vm.prank(importer);
        escrow.raiseDispute(po.orderId);
    }

    function test_revert_InvalidState_disputeTwice() public {
        PurchaseOrder memory po = _disputed();
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        vm.prank(exporter);
        escrow.raiseDispute(po.orderId);
    }

    // ================================================================== resolve

    function test_resolve_splitsRemainingAfterAdvance() public {
        PurchaseOrder memory po = _disputed();
        uint256 toImp = 4_000e6;
        uint256 toExp = BALANCE - toImp;
        uint256 impBefore = usdc.balanceOf(importer);

        vm.expectEmit(address(escrow));
        emit ITradeEscrow.DisputeResolved(po.orderId, toImp, toExp);
        vm.prank(relayer);
        escrow.resolve(po.orderId, toImp, toExp, _signRes(arbiterPk, po.orderId, toImp, toExp));

        assertEq(usdc.balanceOf(importer) - impBefore, toImp);
        assertEq(usdc.balanceOf(payout), ADVANCE + toExp);
        assertEq(usdc.balanceOf(arbiter), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.orderOf(po.orderId).paidOut, TOTAL);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.RESOLVED));
    }

    function test_resolve_fromShipped() public {
        PurchaseOrder memory po = _shipped();
        vm.prank(importer);
        escrow.raiseDispute(po.orderId);
        escrow.resolve(po.orderId, 0, BALANCE, _signRes(arbiterPk, po.orderId, 0, BALANCE));
        assertEq(usdc.balanceOf(payout), TOTAL);
    }

    /// After the advance, the split must equal the remaining balance, not the total.
    function test_revert_BadResolution_sumIsTotalAfterAdvance() public {
        PurchaseOrder memory po = _disputed();
        vm.expectRevert(ITradeEscrow.BadResolution.selector);
        escrow.resolve(po.orderId, TOTAL, 0, _signRes(arbiterPk, po.orderId, TOTAL, 0));
    }

    function test_revert_BadResolution_sumBelowBalance() public {
        PurchaseOrder memory po = _disputed();
        vm.expectRevert(ITradeEscrow.BadResolution.selector);
        escrow.resolve(po.orderId, 1, 1, _signRes(arbiterPk, po.orderId, 1, 1));
    }

    function test_revert_BadArbiterSignature_otherKey() public {
        PurchaseOrder memory po = _disputed();
        vm.expectRevert(ITradeEscrow.BadArbiterSignature.selector);
        escrow.resolve(po.orderId, BALANCE, 0, _signRes(attackerPk, po.orderId, BALANCE, 0));
    }

    /// A party cannot resolve its own dispute.
    function test_revert_BadArbiterSignature_signedByImporter() public {
        PurchaseOrder memory po = _disputed();
        vm.expectRevert(ITradeEscrow.BadArbiterSignature.selector);
        escrow.resolve(po.orderId, BALANCE, 0, _signRes(importerPk, po.orderId, BALANCE, 0));
    }

    /// The resolution is rebuilt from the call arguments: a signature over another split
    /// does not authorize this one.
    function test_revert_BadArbiterSignature_splitChanged() public {
        PurchaseOrder memory po = _disputed();
        bytes memory sig = _signRes(arbiterPk, po.orderId, 0, BALANCE);
        vm.expectRevert(ITradeEscrow.BadArbiterSignature.selector);
        escrow.resolve(po.orderId, BALANCE, 0, sig);
    }

    function test_revert_BadArbiterSignature_otherOrder() public {
        PurchaseOrder memory a = _disputed();
        PurchaseOrder memory b = _disputed();
        bytes memory sigB = _signRes(arbiterPk, b.orderId, BALANCE, 0);
        vm.expectRevert(ITradeEscrow.BadArbiterSignature.selector);
        escrow.resolve(a.orderId, BALANCE, 0, sigB);
    }

    function test_revert_InvalidState_resolveWithoutDispute() public {
        PurchaseOrder memory po = _advancePaid();
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.resolve(po.orderId, BALANCE, 0, _signRes(arbiterPk, po.orderId, BALANCE, 0));
    }

    // ================================================================== cancel

    function test_cancel_fromOpenMovesNothing() public {
        PurchaseOrder memory po = _opened();
        uint256 n = _cancelNonce(po.orderId);
        bytes memory cI = _signCancel(importerPk, po.orderId, n);
        bytes memory cE = _signCancel(exporterPk, po.orderId, n);
        vm.expectEmit(address(escrow));
        emit ITradeEscrow.OrderCancelled(po.orderId, 0);
        vm.prank(relayer);
        escrow.cancel(po.orderId, cI, cE);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.CANCELLED));
        assertEq(escrow.orderOf(po.orderId).paidOut, 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_cancel_fromAdvancePaidRefundsBalance() public {
        PurchaseOrder memory po = _advancePaid();
        uint256 before = usdc.balanceOf(importer);
        vm.expectEmit(address(escrow));
        emit ITradeEscrow.OrderCancelled(po.orderId, BALANCE);
        _cancel(po);
        assertEq(usdc.balanceOf(importer) - before, BALANCE);
        assertEq(usdc.balanceOf(payout), ADVANCE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.orderOf(po.orderId).paidOut, TOTAL);
    }

    /// M1: both parties together can leave a dispute without the arbiter.
    function test_cancel_fromDisputedRefundsRemaining() public {
        PurchaseOrder memory po = _disputed();
        uint256 before = usdc.balanceOf(importer);
        vm.expectEmit(address(escrow));
        emit ITradeEscrow.OrderCancelled(po.orderId, BALANCE);
        _cancel(po);
        assertEq(usdc.balanceOf(importer) - before, BALANCE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.orderOf(po.orderId).paidOut, TOTAL);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.CANCELLED));
    }

    function test_cancel_fromDisputedAfterShipment() public {
        PurchaseOrder memory po = _shipped();
        vm.prank(importer);
        escrow.raiseDispute(po.orderId);
        _cancel(po);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.CANCELLED));
    }

    function test_revert_BadImporterSignature_cancel() public {
        PurchaseOrder memory po = _advancePaid();
        uint256 n = _cancelNonce(po.orderId);
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.cancel(po.orderId, _signCancel(attackerPk, po.orderId, n), _signCancel(exporterPk, po.orderId, n));
    }

    function test_revert_BadExporterSignature_cancel() public {
        PurchaseOrder memory po = _advancePaid();
        uint256 n = _cancelNonce(po.orderId);
        vm.expectRevert(ITradeEscrow.BadExporterSignature.selector);
        escrow.cancel(po.orderId, _signCancel(importerPk, po.orderId, n), _signCancel(attackerPk, po.orderId, n));
    }

    /// One party alone cannot use cancel to leave a dispute.
    function test_revert_BadExporterSignature_cancelFromDisputedImporterOnly() public {
        PurchaseOrder memory po = _disputed();
        uint256 n = _cancelNonce(po.orderId);
        vm.expectRevert(ITradeEscrow.BadExporterSignature.selector);
        escrow.cancel(po.orderId, _signCancel(importerPk, po.orderId, n), _signCancel(importerPk, po.orderId, n));
    }

    /// The contract builds CancelOrder from cancelNonceOf: the order's own nonce, the bare
    /// stateVersion or another value do not work.
    function test_revert_BadImporterSignature_cancelWrongNonce() public {
        PurchaseOrder memory po = _advancePaid();
        uint256 n = _cancelNonce(po.orderId);
        uint256 version = _version(po.orderId);
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.cancel(
            po.orderId, _signCancel(importerPk, po.orderId, n + 1), _signCancel(exporterPk, po.orderId, n + 1)
        );
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.cancel(
            po.orderId, _signCancel(importerPk, po.orderId, po.nonce), _signCancel(exporterPk, po.orderId, po.nonce)
        );
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.cancel(
            po.orderId, _signCancel(importerPk, po.orderId, version), _signCancel(exporterPk, po.orderId, version)
        );
    }

    function test_revert_BadImporterSignature_cancelSignaturesOfOtherOrder() public {
        PurchaseOrder memory a = _advancePaid();
        PurchaseOrder memory b = _advancePaid();
        uint256 n = _cancelNonce(b.orderId);
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.cancel(a.orderId, _signCancel(importerPk, b.orderId, n), _signCancel(exporterPk, b.orderId, n));
    }

    /// A cancel signed while OPEN is not valid once the order is funded.
    function test_revert_BadImporterSignature_cancelSignedInOpenUsedAfterFund() public {
        PurchaseOrder memory po = _opened();
        uint256 nOpen = _cancelNonce(po.orderId);
        bytes memory cI = _signCancel(importerPk, po.orderId, nOpen);
        bytes memory cE = _signCancel(exporterPk, po.orderId, nOpen);
        _fund(po);
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.cancel(po.orderId, cI, cE);
    }

    /// The nonce binds the state as well as the version: signatures for "version N in
    /// ADVANCE_PAID" are rejected by an order that is at version N in DISPUTED.
    function test_revert_BadImporterSignature_cancelSameVersionOtherState() public {
        PurchaseOrder memory po = _disputed();
        uint256 v = _version(po.orderId);
        uint256 nAdvancePaid = _nonceFor(v, ITradeEscrow.State.ADVANCE_PAID);
        assertEq(_cancelNonce(po.orderId), _nonceFor(v, ITradeEscrow.State.DISPUTED));
        bytes memory cI = _signCancel(importerPk, po.orderId, nAdvancePaid);
        bytes memory cE = _signCancel(exporterPk, po.orderId, nAdvancePaid);
        vm.expectRevert(ITradeEscrow.BadImporterSignature.selector);
        escrow.cancel(po.orderId, cI, cE);
    }

    function test_revert_InvalidState_cancelFromShipped() public {
        PurchaseOrder memory po = _shipped();
        uint256 n = _cancelNonce(po.orderId);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.cancel(po.orderId, _signCancel(importerPk, po.orderId, n), _signCancel(exporterPk, po.orderId, n));
    }

    function test_revert_InvalidState_cancelUnknownOrder() public {
        bytes32 id = keccak256("unknown");
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.cancel(id, _signCancel(importerPk, id, 0), _signCancel(exporterPk, id, 0));
    }

    // ================================================================== versions and nonces

    /// stateVersion starts at 1 on open and increments on every transition; cancelNonceOf
    /// packs it with the state.
    function test_stateVersion_andCancelNonce_onEveryTransition() public {
        PurchaseOrder memory po = _po();
        assertEq(_version(po.orderId), 0);
        assertEq(_cancelNonce(po.orderId), 0);
        _open(po);
        assertEq(_version(po.orderId), 1);
        assertEq(_cancelNonce(po.orderId), _nonceFor(1, ITradeEscrow.State.OPEN));
        _fund(po);
        assertEq(_version(po.orderId), 2);
        assertEq(_cancelNonce(po.orderId), _nonceFor(2, ITradeEscrow.State.ADVANCE_PAID));
        _ship(po.orderId);
        assertEq(_version(po.orderId), 3);
        assertEq(_cancelNonce(po.orderId), _nonceFor(3, ITradeEscrow.State.SHIPPED));
        vm.prank(exporter);
        escrow.raiseDispute(po.orderId);
        assertEq(_version(po.orderId), 4);
        assertEq(_cancelNonce(po.orderId), _nonceFor(4, ITradeEscrow.State.DISPUTED));
        _cancel(po);
        assertEq(_version(po.orderId), 5);
        assertEq(_cancelNonce(po.orderId), _nonceFor(5, ITradeEscrow.State.CANCELLED));
    }

    // ================================================================== final states

    /// Every function that moves funds or changes state reverts on a final order, and the
    /// escrow balance, the state and the version do not change.
    function _assertFrozen(PurchaseOrder memory po) internal {
        bytes32 id = po.orderId;
        uint256 escrowBefore = usdc.balanceOf(address(escrow));
        ITradeEscrow.State stateBefore = _state(id);
        uint256 versionBefore = _version(id);

        vm.startPrank(importer);
        usdc.approve(address(escrow), TOTAL);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.fund(id);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.raiseDispute(id);
        usdc.approve(address(escrow), 0);
        vm.stopPrank();

        ShipmentAttestation memory att = _att(id, carrier, "frozen");
        bytes memory attSig = _signAtt(carrierPk, att);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.submitShipment(id, att, attSig);

        DocumentDecision memory d = _decision(id);
        bytes memory docSig = _signDoc(docPk, address(escrow), d);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.releaseBalance(id, d, docSig);

        bytes memory apprSig = _signApproval(importerPk, address(escrow), id, escrow.orderOf(id).attestationHash);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.approveBalance(id, apprSig);

        vm.warp(po.shipmentDeadline + GRACE + 1);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.refundAfterDeadline(id);

        bytes memory resSig = _signRes(arbiterPk, id, 0, 0);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.resolve(id, 0, 0, resSig);

        uint256 n = _cancelNonce(id);
        bytes memory cI = _signCancel(importerPk, id, n);
        bytes memory cE = _signCancel(exporterPk, id, n);
        vm.expectRevert(ITradeEscrow.InvalidState.selector);
        escrow.cancel(id, cI, cE);

        vm.expectRevert(ITradeEscrow.OrderExists.selector);
        _open(po);

        assertEq(usdc.balanceOf(address(escrow)), escrowBefore);
        assertEq(uint8(_state(id)), uint8(stateBefore));
        assertEq(_version(id), versionBefore);
    }

    function test_revert_InvalidState_finalSettled() public {
        PurchaseOrder memory po = _shipped();
        _release(po.orderId);
        _assertFrozen(po);
    }

    function test_revert_InvalidState_finalSettledByApproval() public {
        PurchaseOrder memory po = _shipped();
        _approve(po.orderId);
        _assertFrozen(po);
    }

    function test_revert_InvalidState_finalRefunded() public {
        PurchaseOrder memory po = _advancePaid();
        vm.warp(po.shipmentDeadline + GRACE + 1);
        escrow.refundAfterDeadline(po.orderId);
        _assertFrozen(po);
    }

    function test_revert_InvalidState_finalResolved() public {
        PurchaseOrder memory po = _disputed();
        escrow.resolve(po.orderId, BALANCE, 0, _signRes(arbiterPk, po.orderId, BALANCE, 0));
        _assertFrozen(po);
    }

    function test_revert_InvalidState_finalCancelled() public {
        PurchaseOrder memory po = _advancePaid();
        _cancel(po);
        _assertFrozen(po);
    }

    // ================================================================== reentrancy

    /// The advance leaves inside fund; a payout callback cannot re-enter fund.
    function test_revert_ReentrancyGuardReentrantCall_tokenCallback() public {
        ReentrantToken re = new ReentrantToken();
        TradeEscrow reEscrow = new TradeEscrow(IERC20(address(re)), GRACE);
        PurchaseOrder memory po = _poFor(importer, exporter, address(re));
        _openOn(reEscrow, po);
        re.mint(importer, TOTAL);

        re.arm(address(reEscrow), abi.encodeCall(ITradeEscrow.fund, (po.orderId)));
        vm.startPrank(importer);
        re.approve(address(reEscrow), TOTAL);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        reEscrow.fund(po.orderId);
        vm.stopPrank();
    }

    /// Cross-function reentrancy: the advance payout cannot enter cancel, even with
    /// signatures valid for the state the order has inside the callback.
    function test_revert_ReentrancyGuardReentrantCall_crossFunction() public {
        ReentrantToken re = new ReentrantToken();
        TradeEscrow reEscrow = new TradeEscrow(IERC20(address(re)), GRACE);
        PurchaseOrder memory po = _poFor(importer, exporter, address(re));
        _openOn(reEscrow, po);
        re.mint(importer, TOTAL);

        // Inside the callback the order is at version 2 in ADVANCE_PAID.
        bytes32 cancelHash =
            KeelHash.hash(CancelOrder({orderId: po.orderId, nonce: _nonceFor(2, ITradeEscrow.State.ADVANCE_PAID)}));
        bytes memory cI = _sign(importerPk, _digest(address(reEscrow), cancelHash));
        bytes memory cE = _sign(exporterPk, _digest(address(reEscrow), cancelHash));
        re.arm(address(reEscrow), abi.encodeCall(ITradeEscrow.cancel, (po.orderId, cI, cE)));

        vm.startPrank(importer);
        re.approve(address(reEscrow), TOTAL);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        reEscrow.fund(po.orderId);
        vm.stopPrank();
    }

    // ================================================================== amount edges

    function test_advanceFull_fullFlow() public {
        PurchaseOrder memory po = _po();
        po.advanceBps = 10_000;
        _open(po);
        _fund(po);
        assertEq(usdc.balanceOf(payout), TOTAL);
        _ship(po.orderId);
        _approve(po.orderId);
        assertEq(usdc.balanceOf(payout), TOTAL);
        assertEq(escrow.orderOf(po.orderId).paidOut, TOTAL);
        assertEq(uint8(_state(po.orderId)), uint8(ITradeEscrow.State.SETTLED));
    }

    /// Zero amounts (0% advance, a 100/0 split) are skipped, so a token that reverts on
    /// zero transfers cannot block a transition.
    function test_zeroAmountsSkipped_tokenRevertingOnZero() public {
        ZeroRevertToken zr = new ZeroRevertToken();
        TradeEscrow zrEscrow = new TradeEscrow(IERC20(address(zr)), GRACE);
        PurchaseOrder memory po = _poFor(importer, exporter, address(zr));
        po.advanceBps = 0;
        _openOn(zrEscrow, po);
        zr.mint(importer, TOTAL);
        vm.startPrank(importer);
        zr.approve(address(zrEscrow), TOTAL);
        zrEscrow.fund(po.orderId);
        zrEscrow.raiseDispute(po.orderId);
        vm.stopPrank();

        bytes memory sig = _sign(
            arbiterPk,
            _digest(
                address(zrEscrow),
                KeelHash.hash(DisputeResolution({orderId: po.orderId, toImporter: TOTAL, toExporter: 0}))
            )
        );
        zrEscrow.resolve(po.orderId, TOTAL, 0, sig);
        assertEq(zr.balanceOf(importer), TOTAL);
        assertEq(uint8(zrEscrow.orderOf(po.orderId).state), uint8(ITradeEscrow.State.RESOLVED));
    }

    // ================================================================== fuzz

    /// For any total and advance, fund pays exactly the advance and the release pays the rest:
    /// the payout address gets exactly the total and the escrow ends empty.
    function testFuzz_payoutsEqualTotal(uint256 total, uint16 bps) public {
        total = bound(total, 1, 1e30);
        bps = uint16(bound(bps, 0, 10_000));
        PurchaseOrder memory po = _po();
        po.totalAmount = total;
        po.advanceBps = bps;
        _open(po);
        usdc.mint(importer, total);
        _fund(po);
        assertEq(usdc.balanceOf(payout), (total * bps) / 10_000);
        _ship(po.orderId);
        _release(po.orderId);
        assertEq(usdc.balanceOf(payout), total);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.orderOf(po.orderId).paidOut, total);
    }
}
