// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployPDRGate} from "../script/DeployPDRGate.s.sol";
import {PDRGate} from "../src/PDRGate.sol";
import {MockUSDC, MockSafe, MockRoles} from "./mocks/Mocks.sol";

contract DeployPDRGateTest is Test {
    // Base Sepolia USDC — must match the hardcode in DeployPDRGate.s.sol.
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    string constant TEST_FILE = "./deployments/test-deploy-pdrgate.json";

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
        // Never the real deployments/84532.json: this test reads, merges and then removes the file
        vm.setEnv("KEEL_DEPLOYMENTS_FILE", TEST_FILE);

        PDRGate gate = new DeployPDRGate().run();

        assertEq(gate.safe(), address(safe));
        assertEq(address(gate.roles()), address(roles));
        assertEq(address(gate.usdc()), USDC_BASE_SEPOLIA);
        assertEq(gate.policySigner(), address(0xA11CE));
        assertEq(gate.currentPolicyHash(), keccak256("rules-v1"));

        string memory json = vm.readFile(TEST_FILE);
        assertEq(vm.parseJsonAddress(json, ".pdrGate"), address(gate));
        assertEq(vm.parseJsonAddress(json, ".personal.safe"), address(safe));
        vm.removeFile(TEST_FILE);
    }

    function test_revert_unsupportedChain() public {
        // Anvil default chain (31337) is not in the supported list.
        // No vm.chainId needed; Foundry resets cheatcode state between tests.
        // vm.setEnv is process-wide and the two tests of this file run in parallel: deploying in the
        // same order as the test above gives the same addresses, so the env values they set agree.
        MockUSDC usdc = new MockUSDC();
        MockSafe safe = new MockSafe(address(this));
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
