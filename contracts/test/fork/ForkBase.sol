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

/// @dev Safe 1.4.1, safe-global/safe-smart-account tag v1.4.1 (commit bf943f80):
/// contracts/Safe.sol (setup, execTransaction, nonce, domainSeparator),
/// contracts/base/ModuleManager.sol (enableModule, isModuleEnabled).
interface ISafe141 {
    function setup(
        address[] calldata owners,
        uint256 threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool success);
    function enableModule(address module) external;
    function isModuleEnabled(address module) external view returns (bool);
    function domainSeparator() external view returns (bytes32);
}

/// @dev contracts/proxies/SafeProxyFactory.sol at v1.4.1.
interface ISafeProxyFactory141 {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

/// @dev gnosisguild/zodiac v3.4.1, contracts/factory/ModuleProxyFactory.sol.
interface IModuleProxyFactory {
    function deployModule(address masterCopy, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

/// @dev Circle FiatToken admin functions (USDC proxy on Base Sepolia, version() = "2"), used to
/// make a call fail inside the Safe through the real token and to record the issuer risk.
interface IFiatTokenAdmin {
    function blacklister() external view returns (address);
    function blacklist(address account) external;
    function isBlacklisted(address account) external view returns (bool);
    function pauser() external view returns (address);
    function pause() external;
}

/// @notice Base Sepolia fork with a real Safe 1.4.1, a real Zodiac Roles v2 instance, real USDC and
/// the Keel Trade contracts, wired as in production (T1.7). Skips every test when
/// BASE_SEPOLIA_RPC_URL is not set, so CI without secrets stays green.
abstract contract ForkBase is Test {
    // contracts/CLAUDE.md, section 14 (checked with cast code on Base Sepolia, chainId 84532)
    address constant ROLES_MASTER = 0xF2964CE6161ce0e75964Fe7927cE114cb0B283D5;
    address constant MODULE_FACTORY = 0x000000000000aDdB49795b0f9bA5BC298cDda236;
    address constant SAFE_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;
    address constant SAFE_L2 = 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762;
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    // Safe 1.4.1 CompatibilityFallbackHandler, canonical address in safe-global/safe-deployments
    // (commit 382117f5, src/assets/v1.4.1/compatibility_fallback_handler.json, 84532: canonical).
    // Lets the Safe validate ERC-1271 signatures (it signs purchase orders as the importer).
    address constant FALLBACK_HANDLER = 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99;
    // safe-smart-account v1.4.1, contracts/handler/CompatibilityFallbackHandler.sol
    bytes32 constant SAFE_MSG_TYPEHASH = 0x60b3cbf8b4a223d68d641b3b6ddf9a298e7f33710cf3d3a9d1146b5a6150fbca;

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
