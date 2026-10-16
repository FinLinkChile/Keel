// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {VmSafe} from "forge-std/Vm.sol";

/// @notice deployments/<chainId>.json is shared by DeployTrade and DeployPDRGate. Each script loads
/// the file if it exists, keeps every key it does not own and writes only its own keys:
/// - DeployTrade: deployBlock, safe, roles, delay, tradeEscrow, fundingGate, policySigner,
///   cosigner, refundGrace, configDelay, rolesConfigHash, rolesConfigCalls, trade (object), and
///   pdrGate = null only when absent;
/// - DeployPDRGate: pdrGate and personal (object).
/// Both write chainId and usdc, and refuse to run if the file already holds different values.
/// JSON numbers: Foundry writes integers that do not fit a JSON number safely (for example
/// trade.saltNonce) as decimal strings, and small ones as numbers; readers must accept both.
library DeploymentsFile {
    function defaultPath(uint256 chainId) internal pure returns (string memory) {
        return string.concat("./deployments/", _toString(chainId), ".json");
    }

    /// @dev Seeds the serializer object `root` with the current file (or nothing), checks the
    /// shared keys and writes them. Returns the file content ("{}" when there was no file).
    function load(VmSafe vm, string memory root, string memory path, uint256 chainId, address usdc)
        internal
        returns (string memory existing)
    {
        existing = "{}";
        if (vm.exists(path)) {
            existing = vm.readFile(path);
            if (vm.keyExistsJson(existing, ".chainId")) {
                require(vm.parseJsonUint(existing, ".chainId") == chainId, "deployments file is for another chain");
            }
            if (vm.keyExistsJson(existing, ".usdc")) {
                require(vm.parseJsonAddress(existing, ".usdc") == usdc, "deployments file has another usdc");
            }
            // The shape DeployPDRGate wrote before the file was shared kept the Personal Safe at the top
            // level; merging it would mix Personal and Trade values under the same keys.
            require(
                !vm.keyExistsJson(existing, ".policyHash") && !vm.keyExistsJson(existing, ".agentRoleKey"),
                "deployments file has the old DeployPDRGate shape: move its keys under personal first"
            );
            vm.serializeJson(root, existing);
        }
        vm.serializeUint(root, "chainId", chainId);
        vm.serializeAddress(root, "usdc", usdc);
    }

    function _toString(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        bytes memory b;
        while (v != 0) {
            b = abi.encodePacked(bytes1(uint8(48 + (v % 10))), b);
            v /= 10;
        }
        return string(b);
    }
}
