// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployPDRGate} from "../script/DeployPDRGate.s.sol";
import {PDRGate} from "../src/PDRGate.sol";
import {MockUSDC, MockSafe, MockRoles} from "./mocks/Mocks.sol";

contract DeployPDRGateTest is Test {
    // Base Sepolia USDC — must match the hardcode in DeployPDRGate.s.sol.
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function test_scriptDeploysAndWiresGate() public {
        // Match the chain so the script picks the correct hardcoded USDC address.
        vm.chainId(84532);

        // Place MockUSDC bytecode at the canonical address so the `code.length` check passes.
        MockUSDC mockUsdc = new MockUSDC();
        vm.etch(USDC_BASE_SEPOLIA, address(mockUsdc).code);

        MockSafe safe = new MockSafe(address(this));
        MockRoles roles = new MockRoles(safe, USDC_BASE_SEPOLIA, 300e6, 30 days);

        vm.setEnv("SAFE_ADDRESS", vm.toString(address(safe)));
        vm.setEnv("ROLES_ADDRESS", vm.toString(address(roles)));
        vm.setEnv("POLICY_SIGNER_ADDRESS", vm.toString(address(0xA11CE)));
        vm.setEnv("COSIGNER_ADDRESS", vm.toString(address(0xC051)));
        vm.setEnv("POLICY_HASH", vm.toString(keccak256("rules-v1")));
        vm.setEnv("DEPLOYER_PRIVATE_KEY", "0x1");

        PDRGate gate = new DeployPDRGate().run();

        assertEq(gate.safe(), address(safe));
        assertEq(address(gate.roles()), address(roles));
        assertEq(address(gate.usdc()), USDC_BASE_SEPOLIA);
        assertEq(gate.policySigner(), address(0xA11CE));
        assertEq(gate.currentPolicyHash(), keccak256("rules-v1"));

        string memory json = vm.readFile(string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        assertEq(vm.parseJsonAddress(json, ".pdrGate"), address(gate));
        vm.removeFile(string.concat("./deployments/", vm.toString(block.chainid), ".json"));
    }

    function test_revert_unsupportedChain() public {
        // Anvil default chain (31337) is not in the supported list.
        // No vm.chainId needed; Foundry resets cheatcode state between tests.
        MockSafe safe = new MockSafe(address(this));
        MockUSDC usdc = new MockUSDC();
        MockRoles roles = new MockRoles(safe, address(usdc), 300e6, 30 days);
        vm.setEnv("SAFE_ADDRESS", vm.toString(address(safe)));
        vm.setEnv("ROLES_ADDRESS", vm.toString(address(roles)));
        vm.setEnv("POLICY_SIGNER_ADDRESS", vm.toString(address(0xA11CE)));
        vm.setEnv("COSIGNER_ADDRESS", vm.toString(address(0xC051)));
        vm.setEnv("POLICY_HASH", vm.toString(keccak256("rules-v1")));
        vm.setEnv("DEPLOYER_PRIVATE_KEY", "0x1");
        // Separate construction from the call so expectRevert applies to run().
        DeployPDRGate script = new DeployPDRGate();
        vm.expectRevert("Unsupported chain: 31337");
        script.run();
    }
}
