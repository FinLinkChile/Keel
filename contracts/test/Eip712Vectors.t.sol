// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PDRGate} from "../src/PDRGate.sol";
import {IRoles} from "../src/IRoles.sol";
import {PaymentIntent, PolicyDecision} from "../src/KeelTypes.sol";

/// @notice Writes a fixed EIP-712 test vector that the TypeScript side (schemas/) must
/// reproduce byte for byte (T2.1). If TS and Solidity disagree, the gate rejects everything.
contract Eip712VectorsTest is Test {
    function test_writeVector() public {
        vm.chainId(84532); // Base Sepolia
        address safe = address(0x5AfE00000000000000000000000000000000cAfE);
        address usdc = address(0x036CbD53842c5426634e7929541eC2318f3dCF7e); // USDC on Base Sepolia
        PDRGate gate = new PDRGate(
            safe, IRoles(address(0x2001E5)), IERC20(usdc), keccak256("AGENTE"), address(1), address(2), bytes32(0)
        );

        PaymentIntent memory i = PaymentIntent({
            aliasId: 2,
            recipient: address(0x00000000000000000000000000000000000B0b01),
            amountUsdc: 45_300000,
            invoiceKey: keccak256(abi.encode("761234567", "48213", "202609")),
            deadline: 1_762_300_800,
            nonce: 7
        });
        bytes memory data = abi.encodeCall(IERC20.transfer, (i.recipient, i.amountUsdc));
        PolicyDecision memory d = PolicyDecision({
            intentHash: gate.intentHashOf(i),
            calldataHash: keccak256(data),
            policyHash: keccak256("rules-v1|roles-config-v1"),
            inputsHash: keccak256("fx:950.12|bcch|buda|allowlist-v3"),
            tier: 1,
            expiresAt: 1_762_000_000
        });

        string memory o = "v";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "verifyingContract", address(gate));
        vm.serializeBytes32(o, "domainSeparator", gate.domainSeparator());
        vm.serializeUint(o, "intent_aliasId", i.aliasId);
        vm.serializeAddress(o, "intent_recipient", i.recipient);
        vm.serializeUint(o, "intent_amountUsdc", i.amountUsdc);
        vm.serializeBytes32(o, "intent_invoiceKey", i.invoiceKey);
        vm.serializeUint(o, "intent_deadline", i.deadline);
        vm.serializeUint(o, "intent_nonce", i.nonce);
        vm.serializeBytes(o, "calldata", data);
        vm.serializeBytes32(o, "intentHash", d.intentHash);
        vm.serializeBytes32(o, "calldataHash", d.calldataHash);
        vm.serializeBytes32(o, "policyHash", d.policyHash);
        vm.serializeBytes32(o, "inputsHash", d.inputsHash);
        vm.serializeUint(o, "tier", d.tier);
        vm.serializeUint(o, "expiresAt", d.expiresAt);
        string memory json = vm.serializeBytes32(o, "digest", gate.digestOf(d));
        vm.createDir("./out-vectors", true);
        vm.writeJson(json, "./out-vectors/eip712.json");
    }
}
