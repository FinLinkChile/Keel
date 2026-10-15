// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {IPDRVerifier} from "./IPDRVerifier.sol";
import {PaymentIntent, PolicyDecision} from "./KeelTypes.sol";

// Interface of the gate. Event and error names are fixed (docs/interfaces/eventos-y-errores.md).
// EIP-712 domain: name = "Keel", version = "1", chainId, verifyingContract = PDRGate.
// The errors and events shared with the Trade gate (IntentMismatch, CalldataMismatch,
// BadPolicySignature, MissingCosignature, StalePolicy, Expired, NonceUsed, GateIsPaused,
// GatePaused) are declared in IPDRVerifier and inherited here, with the same names.
interface IPDRGate is IPDRVerifier {
    event PaymentExecuted(bytes32 indexed intentHash, bytes32 pdrHash, uint8 tier, bytes32 indexed invoiceKey);

    // Only the names of the events below are fixed. Their parameters are a proposal
    // to be settled by Areas 1 and 2 at the interface freeze.
    event PaymentHeld(bytes32 indexed intentHash, bytes32 indexed invoiceKey);
    event BeneficiaryChangeQueued(uint8 indexed aliasId, address previousRecipient, address newRecipient);
    event BeneficiaryChangeVetoed(uint8 indexed aliasId, address newRecipient);
    event AgentRoleRevoked(address indexed by);

    error InvoiceAlreadyPaid();

    function execute(
        PaymentIntent calldata intent,
        PolicyDecision calldata d,
        bytes calldata sigPolicy,
        bytes calldata sigCosigner
    ) external;
}
