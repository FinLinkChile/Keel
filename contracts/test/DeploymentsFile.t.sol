// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {DeployTrade} from "../script/DeployTrade.s.sol";
import {DeployPDRGate} from "../script/DeployPDRGate.s.sol";
import {ISafe141, IDelay110} from "../script/KeelExternal.sol";
import {IZodiacRolesV2} from "../script/TradeRolesConfig.sol";
import {TradeEscrow} from "../src/TradeEscrow.sol";
import {FundingGate} from "../src/FundingGate.sol";

/// @notice deployments/<chainId>.json is shared: DeployTrade and DeployPDRGate each keep the keys
/// the other wrote and rewrite only their own. No chain is needed, only the two writers.
contract DeploymentsFileTest is Test {
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    DeployTrade trade;
    DeployPDRGate personal;

    function setUp() public {
        vm.chainId(84532);
        trade = new DeployTrade();
        personal = new DeployPDRGate();
    }

    function _path(string memory name) internal pure returns (string memory) {
        return string.concat("./deployments/test-", name, ".json");
    }

    function _trade(uint256 seed) internal view returns (DeployTrade.Config memory c, DeployTrade.Deployed memory d) {
        c.owner = address(uint160(0x1000 + seed));
        c.policySigner = address(0xA11CE);
        c.cosigner = address(0xC051);
        c.relayer = address(0x7E1A);
        c.refundGrace = 60;
        c.configDelay = 120;
        c.agentCap = 20_000e6;
        c.cosignedCap = 200_000e6;
        c.period = 30 days;
        c.initialPolicyHash = keccak256("initial");
        c.saltNonce = seed;
        d.safe = ISafe141(address(uint160(0x5AFE00 + seed)));
        d.roles = IZodiacRolesV2(address(uint160(0x2015 + seed)));
        d.delay = IDelay110(address(uint160(0xDE1A + seed)));
        d.escrow = TradeEscrow(address(uint160(0xE5C0 + seed)));
        d.gate = FundingGate(address(uint160(0x6A7E + seed)));
        d.deployBlock = 48_173_000 + seed;
        d.params = trade.paramsFor(c, d);
    }

    function _personal() internal pure returns (DeployPDRGate.Personal memory p) {
        p = DeployPDRGate.Personal({
            usdc: USDC,
            safe: address(0xBEEF),
            roles: address(0xB0B),
            policySigner: address(0xA11CE),
            cosigner: address(0xC051),
            policyHash: keccak256("personal"),
            agentRoleKey: keccak256("AGENTE"),
            pdrGate: address(0x9D96)
        });
    }

    function _assertTrade(string memory json, uint256 seed) internal pure {
        assertEq(vm.parseJsonAddress(json, ".safe"), address(uint160(0x5AFE00 + seed)));
        assertEq(vm.parseJsonAddress(json, ".fundingGate"), address(uint160(0x6A7E + seed)));
        assertEq(vm.parseJsonAddress(json, ".tradeEscrow"), address(uint160(0xE5C0 + seed)));
        assertEq(vm.parseJsonAddress(json, ".delay"), address(uint160(0xDE1A + seed)));
        assertEq(vm.parseJsonUint(json, ".deployBlock"), 48_173_000 + seed);
        assertEq(vm.parseJsonAddress(json, ".trade.owner"), address(uint160(0x1000 + seed)));
    }

    function _assertPersonal(string memory json) internal pure {
        assertEq(vm.parseJsonAddress(json, ".pdrGate"), address(0x9D96));
        assertEq(vm.parseJsonAddress(json, ".personal.safe"), address(0xBEEF));
        assertEq(vm.parseJsonBytes32(json, ".personal.policyHash"), keccak256("personal"));
    }

    function test_personalThenTrade_keepsBoth() public {
        string memory path = _path("personal-then-trade");
        personal.writeDeployment(path, _personal());
        (DeployTrade.Config memory c, DeployTrade.Deployed memory d) = _trade(1);
        trade.writeDeployment(path, c, d);
        string memory json = vm.readFile(path);
        _assertPersonal(json); // pdrGate is kept, not reset to null
        _assertTrade(json, 1);
        assertEq(vm.parseJsonUint(json, ".chainId"), 84532);
        vm.removeFile(path);
    }

    function test_tradeThenPersonal_keepsBoth() public {
        string memory path = _path("trade-then-personal");
        (DeployTrade.Config memory c, DeployTrade.Deployed memory d) = _trade(2);
        trade.writeDeployment(path, c, d);
        string memory before = vm.readFile(path);
        assertTrue(vm.keyExistsJson(before, ".pdrGate"), "pdrGate written when absent");
        assertTrue(vm.indexOf(before, '"pdrGate": null') != type(uint256).max, "pdrGate is JSON null, not text");
        personal.writeDeployment(path, _personal());
        string memory json = vm.readFile(path);
        _assertTrade(json, 2);
        _assertPersonal(json);
        assertEq(vm.parseJsonBytes32(json, ".rolesConfigHash"), vm.parseJsonBytes32(before, ".rolesConfigHash"));
        vm.removeFile(path);
    }

    function test_trade_rewriteOnlyItsKeys() public {
        string memory path = _path("trade-twice");
        personal.writeDeployment(path, _personal());
        (DeployTrade.Config memory c1, DeployTrade.Deployed memory d1) = _trade(3);
        trade.writeDeployment(path, c1, d1);
        (DeployTrade.Config memory c2, DeployTrade.Deployed memory d2) = _trade(4);
        trade.writeDeployment(path, c2, d2);
        string memory json = vm.readFile(path);
        _assertTrade(json, 4);
        _assertPersonal(json);
        vm.removeFile(path);
    }

    function test_rolesConfigCallsHashToRolesConfigHash() public {
        string memory path = _path("config-hash");
        (DeployTrade.Config memory c, DeployTrade.Deployed memory d) = _trade(5);
        trade.writeDeployment(path, c, d);
        string memory json = vm.readFile(path);
        bytes[] memory calls = vm.parseJsonBytesArray(json, ".rolesConfigCalls");
        // configHash = keccak256(abi.encode(Call[])), with Call = (address to = 0, bytes data)
        bytes memory encoded = abi.encode(_asCalls(calls));
        assertEq(keccak256(encoded), vm.parseJsonBytes32(json, ".rolesConfigHash"));
        vm.removeFile(path);
    }

    struct Call {
        address to;
        bytes data;
    }

    function _asCalls(bytes[] memory data) internal pure returns (Call[] memory calls) {
        calls = new Call[](data.length);
        for (uint256 i; i < data.length; i++) {
            calls[i] = Call(address(0), data[i]);
        }
    }

    function test_revert_oldPersonalShape() public {
        string memory path = _path("old-shape");
        vm.writeFile(
            path,
            '{"chainId":84532,"safe":"0x000000000000000000000000000000000000bEEF","policyHash":"0x01","agentRoleKey":"0x02","pdrGate":"0x0000000000000000000000000000000000009d96"}'
        );
        (DeployTrade.Config memory c, DeployTrade.Deployed memory d) = _trade(7);
        vm.expectRevert(bytes("deployments file has the old DeployPDRGate shape: move its keys under personal first"));
        trade.writeDeployment(path, c, d);
        vm.removeFile(path);
    }

    function test_revert_fileOfAnotherChain() public {
        string memory path = _path("other-chain");
        vm.writeFile(path, '{"chainId":8453}');
        (DeployTrade.Config memory c, DeployTrade.Deployed memory d) = _trade(6);
        vm.expectRevert(bytes("deployments file is for another chain"));
        trade.writeDeployment(path, c, d);
        vm.removeFile(path);
    }
}
