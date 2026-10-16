// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {DeployTrade} from "../../script/DeployTrade.s.sol";
import {SetTradePolicy} from "../../script/SetTradePolicy.s.sol";
import {BaseSepolia, ISafe141} from "../../script/KeelExternal.sol";
import {IZodiacRolesV2, TradeRolesConfig} from "../../script/TradeRolesConfig.sol";
import {FundingGate} from "../../src/FundingGate.sol";
import {ITradeEscrow} from "../../src/ITradeEscrow.sol";
import {KeelHash} from "../../src/KeelHash.sol";
import {PurchaseOrder, FundIntent, PolicyDecision} from "../../src/KeelTypes.sol";

/// @notice T1.8: runs the whole DeployTrade script on a Base Sepolia fork (the same `deploy` that
/// `forge script` runs, final checks included), checks the deployments file it writes, funds a
/// tier 1 order end to end with what it deployed, and sets the policy hash through the Delay with
/// SetTradePolicy. Skips when BASE_SEPOLIA_RPC_URL is not set.
contract DeployTradeForkTest is Test {
    uint256 constant FORK_BLOCK = 48_173_000;
    string constant FILE = "./deployments/test-deploy-trade-fork.json";
    uint256 constant TOTAL = 10_000e6;

    // Labelled keys: plain EOAs on Base Sepolia (checked in setUp)
    uint256 deployerKey = uint256(keccak256("keel.deploy.deployer"));
    uint256 ownerKey = uint256(keccak256("keel.deploy.owner"));
    uint256 policyKey = uint256(keccak256("keel.deploy.policy"));
    uint256 cosignerKey = uint256(keccak256("keel.deploy.cosigner"));
    uint256 exporterKey = uint256(keccak256("keel.deploy.exporter"));
    address relayer = makeAddr("keel.deploy.relayer");
    address payout = makeAddr("keel.deploy.payout");
    address carrier = makeAddr("keel.deploy.carrier");
    address arbiter = makeAddr("keel.deploy.arbiter");
    address verifier = makeAddr("keel.deploy.verifier");

    bool forked;
    DeployTrade script;
    DeployTrade.Config c;
    DeployTrade.Deployed d;

    modifier onlyFork() {
        if (!forked) vm.skip(true);
        _;
    }

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc, FORK_BLOCK);
        forked = true;
        assertEq(
            vm.addr(deployerKey).code.length + vm.addr(ownerKey).code.length + vm.addr(policyKey).code.length
                + vm.addr(cosignerKey).code.length + vm.addr(exporterKey).code.length,
            0,
            "test keys must be plain EOAs"
        );

        script = new DeployTrade();
        c = DeployTrade.Config({
            deployerKey: deployerKey,
            owner: vm.addr(ownerKey),
            policySigner: vm.addr(policyKey),
            cosigner: vm.addr(cosignerKey),
            relayer: relayer,
            refundGrace: 60,
            configDelay: 120,
            agentCap: 20_000e6,
            cosignedCap: 200_000e6,
            period: 30 days,
            initialPolicyHash: keccak256("keel-trade/initial-policy-placeholder"),
            saltNonce: uint256(keccak256("keel.deploy.fork-test"))
        });
    }

    function _deploy() internal {
        d = script.deploy(c);
    }

    // ------------------------------------------------------------------ deploy and checks

    /// The script deploys and its final checks pass (they revert otherwise). The membership probes
    /// are pranked calls after stopBroadcast: broadcasting increments the sender nonce and a prank
    /// does not, so the deployer sent exactly the 20 deployment transactions and the relayer and
    /// the cosigner (both probed) sent none.
    function test_fork_deploy_sendsOnlyTheDeploymentTransactions() public onlyFork {
        address deployer = vm.addr(deployerKey);
        uint256 before = vm.getNonce(deployer);
        _deploy();
        // 1 Safe + 2 modules + TradeEscrow + FundingGate + 15 Safe transactions
        // (2 enableModule, 11 Roles configuration calls, 1 Delay enableModule, 1 swapOwner)
        assertEq(vm.getNonce(deployer) - before, 20, "only the deployment was broadcast");
        assertEq(vm.getNonce(relayer), 0, "relayer probe not sent");
        assertEq(vm.getNonce(c.cosigner), 0, "cosigner probe not sent");
        assertEq(d.safe.nonce(), 15, "Safe transactions");
        assertEq(TradeRolesConfig.calls(d.params).length, 11);
    }

    function test_fork_deploy_handsTheSafeToTheOwner() public onlyFork {
        _deploy();
        address[] memory owners = d.safe.getOwners();
        assertEq(owners.length, 1);
        assertEq(owners[0], c.owner);
        assertEq(d.safe.getThreshold(), 1);
        assertFalse(d.safe.isOwner(vm.addr(deployerKey)));
        assertTrue(d.delay.isModuleEnabled(c.owner));
        assertEq(d.gate.currentPolicyHash(), c.initialPolicyHash);
    }

    function test_fork_deploy_failsWithRepeatedAddresses() public onlyFork {
        DeployTrade.Config memory bad = c;
        bad.relayer = bad.cosigner;
        vm.expectRevert(bytes("cosigner and relayer must be different addresses"));
        script.deploy(bad);
        bad = c;
        bad.owner = vm.addr(deployerKey);
        vm.expectRevert(bytes("deployer and owner must be different addresses"));
        script.deploy(bad);
        bad = c;
        bad.policySigner = bad.cosigner;
        vm.expectRevert(bytes("policy signer and cosigner must be different addresses"));
        script.deploy(bad);
    }

    function test_fork_deploy_writesTheDeploymentsFile() public onlyFork {
        _deploy();
        script.writeDeployment(FILE, c, d);
        string memory json = vm.readFile(FILE);
        assertEq(vm.parseJsonUint(json, ".chainId"), 84532);
        assertEq(vm.parseJsonUint(json, ".deployBlock"), d.deployBlock);
        assertEq(vm.parseJsonAddress(json, ".usdc"), BaseSepolia.USDC);
        assertEq(vm.parseJsonAddress(json, ".safe"), address(d.safe));
        assertEq(vm.parseJsonAddress(json, ".roles"), address(d.roles));
        assertEq(vm.parseJsonAddress(json, ".delay"), address(d.delay));
        assertEq(vm.parseJsonAddress(json, ".tradeEscrow"), address(d.escrow));
        assertEq(vm.parseJsonAddress(json, ".fundingGate"), address(d.gate));
        assertTrue(vm.indexOf(json, '"pdrGate": null') != type(uint256).max, "pdrGate is null");
        assertEq(vm.parseJsonAddress(json, ".policySigner"), c.policySigner);
        assertEq(vm.parseJsonAddress(json, ".cosigner"), c.cosigner);
        assertEq(vm.parseJsonUint(json, ".refundGrace"), c.refundGrace);
        assertEq(vm.parseJsonUint(json, ".configDelay"), c.configDelay);
        assertEq(vm.parseJsonBytes32(json, ".rolesConfigHash"), TradeRolesConfig.configHash(d.params));
        bytes[] memory calls = vm.parseJsonBytesArray(json, ".rolesConfigCalls");
        TradeRolesConfig.Call[] memory cfg = TradeRolesConfig.calls(d.params);
        assertEq(calls.length, cfg.length);
        for (uint256 i; i < calls.length; i++) {
            assertEq(calls[i], cfg[i].data);
        }
        assertEq(vm.parseJsonAddress(json, ".trade.owner"), c.owner);
        vm.removeFile(FILE);
    }

    // ------------------------------------------------------------------ record (after the send)

    /// record rebuilds every address from the Safe on the chain, checks it and writes the file.
    function test_fork_record_rebuildsFromTheSafeAndWrites() public onlyFork {
        _deploy();
        DeployTrade.Deployed memory r = script.recordTo(c, address(d.safe), vm.addr(deployerKey), d.deployBlock, FILE);
        assertEq(address(r.roles), address(d.roles));
        assertEq(address(r.delay), address(d.delay));
        assertEq(address(r.gate), address(d.gate));
        assertEq(address(r.escrow), address(d.escrow));
        string memory json = vm.readFile(FILE);
        assertEq(vm.parseJsonAddress(json, ".fundingGate"), address(d.gate));
        assertEq(vm.parseJsonBytes32(json, ".rolesConfigHash"), TradeRolesConfig.configHash(d.params));
        vm.removeFile(FILE);
    }

    /// A Safe that still has another owner besides OWNER_ADDRESS (as if swapOwner never landed) is
    /// refused, and no file is written.
    function test_fork_record_refusesASafeWithAnotherOwner() public onlyFork {
        _deploy();
        _execSafe(
            address(d.safe), abi.encodeWithSignature("addOwnerWithThreshold(address,uint256)", vm.addr(deployerKey), 1)
        );
        vm.expectRevert(bytes("Safe owners must be exactly OWNER_ADDRESS"));
        script.recordTo(c, address(d.safe), vm.addr(deployerKey), d.deployBlock, FILE);
        assertFalse(vm.exists(FILE), "nothing written");
    }

    /// Anything done after the deployment (here, a registry change) means it is not the fresh
    /// deployment the script made: record refuses it.
    function test_fork_record_refusesAUsedDeployment() public onlyFork {
        _deploy();
        _execSafe(address(d.gate), abi.encodeCall(FundingGate.queueSupplier, (vm.addr(exporterKey), payout)));
        vm.expectRevert(bytes("gate registries already used"));
        script.recordTo(c, address(d.safe), vm.addr(deployerKey), d.deployBlock, FILE);
        assertFalse(vm.exists(FILE));
    }

    function test_fork_deploy_failsWithOutOfRangeSettings() public onlyFork {
        DeployTrade.Config memory bad = c;
        bad.configDelay = 59;
        vm.expectRevert(bytes("CONFIG_DELAY must be in [60 s, 30 days]"));
        script.deploy(bad);
        bad = c;
        bad.period = 60;
        vm.expectRevert(bytes("ALLOWANCE_PERIOD must be in [1 hour, 366 days]"));
        script.deploy(bad);
        bad = c;
        bad.cosignedCap = bad.agentCap;
        vm.expectRevert(bytes("need 0 < AGENT_CAP < COSIGNED_CAP"));
        script.deploy(bad);
    }

    // ------------------------------------------------------------------ the checks catch a bad deployment

    function test_fork_checks_failWhenAnOutsiderIsAMember() public onlyFork {
        _deploy();
        bytes32[] memory keys = new bytes32[](1);
        keys[0] = script.AGENT();
        bool[] memory on = new bool[](1);
        on[0] = true;
        _execSafe(address(d.roles), abi.encodeCall(IZodiacRolesV2.assignRoles, (relayer, keys, on)));
        vm.expectRevert(bytes("Roles modules must be exactly the gate"));
        script.checkDeployment(c, d);
    }

    function test_fork_checks_failWithAnExtraSafeModule() public onlyFork {
        _deploy();
        _execSafe(address(d.safe), abi.encodeCall(ISafe141.enableModule, (makeAddr("extra module"))));
        vm.expectRevert(bytes("Safe modules must be exactly Roles and Delay"));
        script.checkDeployment(c, d);
    }

    function test_fork_checks_failWhenMaxRefillDiffersFromRefill() public onlyFork {
        _deploy();
        bytes32 key = script.AGENT_KEY();
        _execSafe(
            address(d.roles),
            abi.encodeCall(IZodiacRolesV2.setAllowance, (key, c.agentCap, c.agentCap * 2, c.agentCap, c.period, 0))
        );
        vm.expectRevert(bytes("allowance maxRefill != refill"));
        script.checkDeployment(c, d);
    }

    // ------------------------------------------------------------------ end to end

    function _execSafe(address to, bytes memory data) internal {
        address owner = c.owner;
        bytes memory sig = abi.encodePacked(bytes32(uint256(uint160(owner))), bytes32(0), uint8(1));
        vm.prank(owner);
        assertTrue(d.safe.execTransaction(to, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), sig));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _safeSign(bytes32 hash) internal view returns (bytes memory) {
        bytes32 safeMsg = keccak256(abi.encode(BaseSepolia.SAFE_MSG_TYPEHASH, keccak256(abi.encode(hash))));
        return
            _sign(ownerKey, keccak256(abi.encodePacked(bytes1(0x19), bytes1(0x01), d.safe.domainSeparator(), safeMsg)));
    }

    /// The owner approves the supplier and third parties, waits the gate delay, both parties sign
    /// an order and the relayer funds it at tier 1 with the deployed contracts.
    function test_fork_deploy_fundsATier1OrderEndToEnd() public onlyFork {
        _deploy();
        address exporter = vm.addr(exporterKey);
        _execSafe(address(d.gate), abi.encodeCall(FundingGate.queueSupplier, (exporter, payout)));
        _execSafe(address(d.gate), abi.encodeCall(FundingGate.queueThirdParty, (carrier, 1)));
        _execSafe(address(d.gate), abi.encodeCall(FundingGate.queueThirdParty, (arbiter, 2)));
        _execSafe(address(d.gate), abi.encodeCall(FundingGate.queueThirdParty, (verifier, 4)));
        vm.warp(vm.getBlockTimestamp() + c.configDelay);
        deal(BaseSepolia.USDC, address(d.safe), 100_000e6);

        PurchaseOrder memory po = PurchaseOrder({
            orderId: keccak256(abi.encode(address(d.safe), exporter, uint256(1))),
            importer: address(d.safe),
            exporter: exporter,
            payoutAddress: payout,
            token: BaseSepolia.USDC,
            totalAmount: TOTAL,
            advanceBps: 3000,
            shipmentDeadline: uint64(vm.getBlockTimestamp() + 30 days),
            disputeWindow: 7 days,
            carrier: carrier,
            arbiter: arbiter,
            documentVerifier: verifier,
            incoterm: bytes32("FOB"),
            termsHash: keccak256("terms"),
            requiredDocsHash: keccak256("BL+invoice"),
            nonce: 1
        });
        bytes32 orderDigest =
            KeelHash.digest(KeelHash.domainSeparator(block.chainid, address(d.escrow)), KeelHash.hash(po));
        d.escrow.open(po, _safeSign(orderDigest), _sign(exporterKey, orderDigest));

        FundIntent memory i = FundIntent({
            orderId: po.orderId,
            orderHash: KeelHash.hash(po),
            escrow: address(d.escrow),
            token: BaseSepolia.USDC,
            amount: TOTAL,
            deadline: uint64(vm.getBlockTimestamp() + 15 minutes),
            nonce: 1
        });
        (,, bytes32 calldataHash) = d.gate.fundingCalldataOf(i);
        PolicyDecision memory pd = PolicyDecision({
            intentHash: KeelHash.hash(i),
            calldataHash: calldataHash,
            policyHash: d.gate.currentPolicyHash(),
            inputsHash: keccak256("deploy fork"),
            tier: 1,
            expiresAt: uint64(vm.getBlockTimestamp() + 10 minutes)
        });
        bytes32 pdr = KeelHash.digest(KeelHash.domainSeparator(block.chainid, address(d.gate)), KeelHash.hash(pd));
        vm.prank(relayer);
        d.gate.execute(i, pd, _sign(policyKey, pdr), "");

        assertEq(uint8(d.escrow.orderOf(po.orderId).state), uint8(ITradeEscrow.State.ADVANCE_PAID));
        (,,, uint128 balance,) = d.roles.allowances(script.AGENT_KEY());
        assertEq(balance, c.agentCap - TOTAL);
        assertEq(IERC20(BaseSepolia.USDC).allowance(address(d.safe), address(d.escrow)), 0);
        assertEq(IERC20(BaseSepolia.USDC).balanceOf(payout), (TOTAL * 3000) / 10_000);
    }

    // ------------------------------------------------------------------ policy hash

    /// SetTradePolicy queues setPolicyHash on the Delay with the owner key; it cannot run before the
    /// 180 s cooldown, and after it anyone executes it and the gate holds the new hash.
    function test_fork_setTradePolicy_throughTheDelay() public onlyFork {
        _deploy();
        SetTradePolicy sp = new SetTradePolicy();
        bytes32 h = keccak256("area 2 trade policy hash");
        sp.queueWith(d.gate, d.delay, h, ownerKey);
        assertEq(d.gate.currentPolicyHash(), c.initialPolicyHash, "nothing changes while queued");

        vm.warp(vm.getBlockTimestamp() + script.DELAY_COOLDOWN() - 1);
        vm.expectRevert(bytes("the Delay cooldown has not passed"));
        sp.executeWith(d.gate, d.delay, h, uint256(keccak256("anyone")));

        vm.warp(vm.getBlockTimestamp() + 1);
        sp.executeWith(d.gate, d.delay, h, uint256(keccak256("anyone")));
        assertEq(d.gate.currentPolicyHash(), h);
    }

    function test_fork_setTradePolicy_revertsOnceExpired() public onlyFork {
        _deploy();
        SetTradePolicy sp = new SetTradePolicy();
        bytes32 h = keccak256("late");
        sp.queueWith(d.gate, d.delay, h, ownerKey);
        vm.warp(vm.getBlockTimestamp() + script.DELAY_COOLDOWN() + script.DELAY_EXPIRATION() + 1);
        vm.expectRevert(bytes("the queued transaction expired"));
        sp.executeWith(d.gate, d.delay, h, uint256(keccak256("anyone")));
    }

    function test_fork_setTradePolicy_revertsForAKeyThatIsNotADelayModule() public onlyFork {
        _deploy();
        SetTradePolicy sp = new SetTradePolicy();
        vm.expectRevert(bytes("the key is not a module of the Delay"));
        sp.queueWith(d.gate, d.delay, keccak256("x"), deployerKey);
    }
}
