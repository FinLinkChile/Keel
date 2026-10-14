// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PDRGate} from "../src/PDRGate.sol";
import {IRoles} from "../src/IRoles.sol";

/// @notice Deploys PDRGate against an existing Safe + Roles Modifier and records the address
/// in deployments/<chainId>.json (integration point 2, Wednesday Oct 14).
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

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "safe", safe);
        vm.serializeAddress(o, "roles", roles);
        vm.serializeAddress(o, "usdc", usdc);
        vm.serializeAddress(o, "policySigner", policySigner);
        vm.serializeAddress(o, "cosigner", cosigner);
        vm.serializeBytes32(o, "policyHash", policyHash);
        vm.serializeBytes32(o, "agentRoleKey", roleKey);
        string memory json = vm.serializeAddress(o, "pdrGate", address(gate));
        vm.createDir("./deployments", true);
        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
    }
}
