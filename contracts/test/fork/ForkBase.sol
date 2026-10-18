// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {FundingGate} from "../../src/FundingGate.sol";
import {IRoles} from "../../src/IRoles.sol";
import {TradeEscrow} from "../../src/TradeEscrow.sol";
import {KeelHash} from "../../src/KeelHash.sol";
import {PurchaseOrder, FundIntent, PolicyDecision} from "../../src/KeelTypes.sol";
import {IZodiacRolesV2, TradeRolesConfig} from "../../script/TradeRolesConfig.sol";
import {
    BaseSepolia,
    IFiatTokenAdmin,
    IModuleProxyFactory,
    ISafe141,
    ISafeProxyFactory141
} from "../../script/KeelExternal.sol";

/// @notice Base Sepolia fork with a real Safe 1.4.1, a real Zodiac Roles v2 instance, real USDC and
/// the Keel Trade contracts, wired as in production (T1.7). Skips every test when
/// BASE_SEPOLIA_RPC_URL is not set, so CI without secrets stays green.
abstract contract ForkBase is Test {
    // Addresses and their sources: script/KeelExternal.sol (shared with the deployment scripts)
    address constant ROLES_MASTER = BaseSepolia.ROLES_MASTER;
    address constant MODULE_FACTORY = BaseSepolia.MODULE_FACTORY;
    address constant SAFE_FACTORY = BaseSepolia.SAFE_FACTORY;
    address constant SAFE_L2 = BaseSepolia.SAFE_L2;
    address constant USDC = BaseSepolia.USDC;
    address constant FALLBACK_HANDLER = BaseSepolia.FALLBACK_HANDLER;
    bytes32 constant SAFE_MSG_TYPEHASH = BaseSepolia.SAFE_MSG_TYPEHASH;

    /// Fixed block, so every run reads the same chain state.
    uint256 constant FORK_BLOCK = 48_173_000;

    bytes32 constant AGENT = keccak256("AGENT");
    bytes32 constant AGENT_COSIGNED = keccak256("AGENT_COSIGNED");
    bytes32 constant AGENT_KEY = keccak256("keel.trade.allowance.agent");
    bytes32 constant COSIGNED_KEY = keccak256("keel.trade.allowance.cosigned");
    uint128 constant AGENT_CAP = 20_000e6;
    uint128 constant COSIGNED_CAP = 200_000e6;
    uint64 constant PERIOD = 30 days;
    uint64 constant CONFIG_DELAY = 60;
    uint64 constant GRACE = 60;
    bytes32 constant POLICY = keccak256("keel-trade fork policy");

    uint8 constant CARRIER = 1;
    uint8 constant ARBITER = 2;
    uint8 constant VERIFIER = 4;

    // Keys derived from labels: short well-known test keys can have code on a live network (the
    // address of 0x2222 carries an EIP-7702 delegation on Base Sepolia, so SignatureChecker treats it
    // as an ERC-1271 wallet and an exporter signature from that key fails).
    uint256 ownerPk = uint256(keccak256("keel.fork.owner"));
    uint256 exporterPk = uint256(keccak256("keel.fork.exporter"));
    uint256 policyPk = uint256(keccak256("keel.fork.policy"));
    uint256 cosignerPk = uint256(keccak256("keel.fork.cosigner"));
    address owner;
    address exporter;
    address relayer = makeAddr("relayer");
    address payout = makeAddr("payout");
    address carrier = makeAddr("carrier");
    address arbiter = makeAddr("arbiter");
    address verifier = makeAddr("verifier");

    bool forked;
    ISafe141 safe;
    IZodiacRolesV2 roles;
    TradeEscrow escrow;
    FundingGate gate;
    IERC20 usdc = IERC20(USDC);
    TradeRolesConfig.Params params;

    uint256 nextOrderNonce = 1;
    uint256 nextIntentNonce = 1;

    modifier onlyFork() {
        if (!forked) vm.skip(true);
        _;
    }

    function setUp() public virtual {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc, FORK_BLOCK);
        forked = true;
        assertEq(block.chainid, 84532, "Base Sepolia");
        address[6] memory used = [ROLES_MASTER, MODULE_FACTORY, SAFE_FACTORY, SAFE_L2, USDC, FALLBACK_HANDLER];
        for (uint256 i; i < used.length; i++) {
            assertGt(used[i].code.length, 0, "address without code at the fork block");
        }

        owner = vm.addr(ownerPk);
        exporter = vm.addr(exporterPk);
        assertEq(
            owner.code.length + exporter.code.length + vm.addr(policyPk).code.length + vm.addr(cosignerPk).code.length,
            0,
            "test keys must be plain EOAs"
        );

        // Safe 1.4.1 through the official factory, one test owner, with the compatibility handler
        address[] memory owners = new address[](1);
        owners[0] = owner;
        bytes memory init = abi.encodeCall(
            ISafe141.setup, (owners, 1, address(0), "", FALLBACK_HANDLER, address(0), 0, payable(address(0)))
        );
        safe = ISafe141(
            ISafeProxyFactory141(SAFE_FACTORY).createProxyWithNonce(SAFE_L2, init, uint256(keccak256("keel")))
        );

        // Roles instance from the master copy: owner = avatar = target = Safe, enabled on the Safe
        bytes memory rolesInit =
            abi.encodeCall(IZodiacRolesV2.setUp, (abi.encode(address(safe), address(safe), address(safe))));
        roles = IZodiacRolesV2(
            IModuleProxyFactory(MODULE_FACTORY).deployModule(ROLES_MASTER, rolesInit, uint256(keccak256("keel")))
        );
        execSafe(address(safe), abi.encodeCall(ISafe141.enableModule, (address(roles))));

        escrow = new TradeEscrow(usdc, GRACE);
        gate = new FundingGate(
            address(safe),
            IRoles(address(roles)),
            escrow,
            AGENT,
            AGENT_COSIGNED,
            vm.addr(policyPk),
            vm.addr(cosignerPk),
            POLICY,
            CONFIG_DELAY
        );

        // The Roles configuration, made by the Safe from the shared library (T1.2, T1.8)
        params = TradeRolesConfig.Params({
            token: USDC,
            escrow: address(escrow),
            gate: address(gate),
            agentRole: AGENT,
            cosignedRole: AGENT_COSIGNED,
            agentAllowanceKey: AGENT_KEY,
            cosignedAllowanceKey: COSIGNED_KEY,
            agentCap: AGENT_CAP,
            cosignedCap: COSIGNED_CAP,
            period: PERIOD
        });
        TradeRolesConfig.Call[] memory cfg = TradeRolesConfig.calls(params);
        for (uint256 i; i < cfg.length; i++) {
            execSafe(address(roles), cfg[i].data);
        }

        // Registries of the gate: queued by the Safe, active after the delay
        execSafe(address(gate), abi.encodeCall(FundingGate.queueSupplier, (exporter, payout)));
        execSafe(address(gate), abi.encodeCall(FundingGate.queueThirdParty, (carrier, CARRIER)));
        execSafe(address(gate), abi.encodeCall(FundingGate.queueThirdParty, (arbiter, ARBITER)));
        execSafe(address(gate), abi.encodeCall(FundingGate.queueThirdParty, (verifier, VERIFIER)));
        vm.warp(block.timestamp + CONFIG_DELAY);

        deal(USDC, address(safe), 1_000_000e6);
    }

    // ------------------------------------------------------------------ Safe

    /// One-owner Safe transaction, signed with v = 1 (Safe.sol at v1.4.1, checkNSignatures:
    /// r is the owner and msg.sender is that owner). safeTxGas = gasPrice = 0, so a failing inner
    /// call reverts the Safe transaction (GS013) instead of returning false.
    function execSafe(address to, bytes memory data) internal {
        bytes memory sig = abi.encodePacked(bytes32(uint256(uint160(owner))), bytes32(0), uint8(1));
        vm.prank(owner);
        bool ok = safe.execTransaction(to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), sig);
        assertTrue(ok, "Safe transaction failed");
    }

    /// ERC-1271 signature of the Safe over a 32-byte hash, as CompatibilityFallbackHandler checks it:
    /// the owner signs the SafeMessage of abi.encode(hash).
    function safeSign(bytes32 hash) internal view returns (bytes memory) {
        bytes32 safeMsg = keccak256(abi.encode(SAFE_MSG_TYPEHASH, keccak256(abi.encode(hash))));
        bytes32 digest = keccak256(abi.encodePacked(bytes1(0x19), bytes1(0x01), safe.domainSeparator(), safeMsg));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------------ orders and PDRs

    function openOrder(address payout_, uint256 amount) internal returns (PurchaseOrder memory po) {
        uint256 n = nextOrderNonce++;
        po = PurchaseOrder({
            orderId: keccak256(abi.encode(address(safe), exporter, n)),
            importer: address(safe),
            exporter: exporter,
            payoutAddress: payout_,
            token: USDC,
            totalAmount: amount,
            advanceBps: 3000,
            shipmentDeadline: uint64(block.timestamp + 30 days),
            disputeWindow: 7 days,
            carrier: carrier,
            arbiter: arbiter,
            documentVerifier: verifier,
            incoterm: bytes32("FOB"),
            termsHash: keccak256("terms"),
            requiredDocsHash: keccak256("BL+invoice"),
            nonce: n
        });
        bytes32 digest = KeelHash.digest(KeelHash.domainSeparator(block.chainid, address(escrow)), KeelHash.hash(po));
        escrow.open(po, safeSign(digest), sign(exporterPk, digest));
    }

    function intentFor(PurchaseOrder memory po) internal returns (FundIntent memory) {
        return FundIntent({
            orderId: po.orderId,
            orderHash: KeelHash.hash(po),
            escrow: address(escrow),
            token: USDC,
            amount: po.totalAmount,
            deadline: uint64(block.timestamp + 15 minutes),
            nonce: nextIntentNonce++
        });
    }

    function decisionFor(FundIntent memory i, uint8 tier) internal view returns (PolicyDecision memory) {
        (,, bytes32 calldataHash) = gate.fundingCalldataOf(i);
        return PolicyDecision({
            intentHash: KeelHash.hash(i),
            calldataHash: calldataHash,
            policyHash: POLICY,
            inputsHash: keccak256("fork"),
            tier: tier,
            expiresAt: uint64(block.timestamp + 10 minutes)
        });
    }

    function pdrDigest(PolicyDecision memory d) internal view returns (bytes32) {
        return KeelHash.digest(KeelHash.domainSeparator(block.chainid, address(gate)), KeelHash.hash(d));
    }

    function balanceOf(bytes32 key) internal view returns (uint128 balance) {
        (,,, balance,) = roles.allowances(key);
    }

    function violation(uint8 status, bytes32 info) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IZodiacRolesV2.ConditionViolation.selector, status, info);
    }
}
