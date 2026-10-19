// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PDRGate} from "../src/PDRGate.sol";
import {IRoles} from "../src/IRoles.sol";
import {DeploymentsFile} from "./DeploymentsFile.sol";

/// @notice Deploys PDRGate against an existing Safe + Roles Modifier and records the address
/// in deployments/<chainId>.json (integration point 2, Wednesday Oct 14), merged with what Keel
/// Trade wrote there (see DeploymentsFile.sol): this script owns only `pdrGate` and `personal`.
/// @dev After deploying, the Safe must still (through the Delay path):
///   1. assign the AGENTE role in Roles to the gate address (and to nothing else, decision D4);
///   2. scope the COSIGNATARIO role to PDRGate.pause() and Roles membership revocation.
///
/// Env: SAFE_ADDRESS, ROLES_ADDRESS, POLICY_SIGNER_ADDRESS, COSIGNER_ADDRESS,
///      POLICY_HASH, AGENT_ROLE_KEY (optional, defaults to keccak256("AGENTE")),
///      DEPLOYER_PRIVATE_KEY (the deployer only pays gas; it gets no rights over the gate).
/// USDC address is hardcoded per network (Base Sepolia / Base mainnet); any other chain reverts.
///
/// forge script script/DeployPDRGate.s.sol --rpc-url base_sepolia --broadcast --verify
contract DeployPDRGate is Script {
    function run() external returns (PDRGate gate) {
        address safe = vm.envAddress("SAFE_ADDRESS");
        address roles = vm.envAddress("ROLES_ADDRESS");
        address policySigner = vm.envAddress("POLICY_SIGNER_ADDRESS");
        address cosigner = vm.envAddress("COSIGNER_ADDRESS");
        bytes32 policyHash = vm.envBytes32("POLICY_HASH");
        bytes32 roleKey = vm.envOr("AGENT_ROLE_KEY", keccak256("AGENTE"));

        // USDC address is a protocol constant, not a deployment parameter.
        address usdc;
        if (block.chainid == 84532) {
            usdc = 0x036CbD53842c5426634e7929541eC2318f3dCF7e; // USDC Base Sepolia
        } else if (block.chainid == 8453) {
            usdc = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913; // USDC Base mainnet
        } else {
            revert(string.concat("Unsupported chain: ", vm.toString(block.chainid)));
        }

        require(safe.code.length > 0, "SAFE_ADDRESS has no code");
        require(roles.code.length > 0, "ROLES_ADDRESS has no code");
        require(usdc.code.length > 0, "USDC has no code on this network");
        require(policySigner != address(0) && cosigner != address(0), "signer/cosigner unset");
        require(policySigner != cosigner, "policy signer must differ from cosigner");

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        gate = new PDRGate(safe, IRoles(roles), IERC20(usdc), roleKey, policySigner, cosigner, policyHash);
        vm.stopBroadcast();

        console2.log("PDRGate", address(gate));

        writeDeployment(
            vm.envOr("KEEL_DEPLOYMENTS_FILE", DeploymentsFile.defaultPath(block.chainid)),
            Personal(usdc, safe, roles, policySigner, cosigner, policyHash, roleKey, address(gate))
        );
    }

    struct Personal {
        address usdc;
        address safe;
        address roles;
        address policySigner;
        address cosigner;
        bytes32 policyHash;
        bytes32 agentRoleKey;
        address pdrGate;
    }

    /// @notice Writes the Personal gate into `path`, keeping every key another script owns (Keel
    /// Trade writes the top-level safe, roles, signers and its contracts). This script owns only
    /// `pdrGate` and the `personal` object; chainId and usdc are shared and must match.
    function writeDeployment(string memory path, Personal memory d) public {
        string memory root = "personal-root";
        vm.createDir("./deployments", true);
        DeploymentsFile.load(vm, root, path, block.chainid, d.usdc);
        string memory p = "personal-object";
        vm.serializeAddress(p, "safe", d.safe);
        vm.serializeAddress(p, "roles", d.roles);
        vm.serializeAddress(p, "policySigner", d.policySigner);
        vm.serializeAddress(p, "cosigner", d.cosigner);
        vm.serializeBytes32(p, "policyHash", d.policyHash);
        string memory personal = vm.serializeBytes32(p, "agentRoleKey", d.agentRoleKey);
        vm.serializeString(root, "personal", personal);
        string memory json = vm.serializeAddress(root, "pdrGate", d.pdrGate);
        vm.writeJson(json, path);
    }
}
