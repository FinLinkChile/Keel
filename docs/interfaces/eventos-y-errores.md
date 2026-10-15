---
type: Interfaz
title: "Eventos y errores tipados"
description: "Nombres fijos de los eventos y errores de PDRGate, del gate de Trade (FundingGate) y de TradeEscrow, por modo."
tags: [eventos, errores, pdrgate, funding-gate, trade-escrow]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T16:30:00Z }
---

**Personal (base):**

* PDRGate, eventos: `PaymentExecuted`, `PaymentHeld`, `BeneficiaryChangeQueued`, `BeneficiaryChangeVetoed`, `AgentRoleRevoked`, `GatePaused`.
* PDRGate, errores: `IntentMismatch`, `CalldataMismatch`, `BadPolicySignature`, `MissingCosignature`, `StalePolicy`, `Expired`, `NonceUsed`, `InvoiceAlreadyPaid`, `GateIsPaused`.
* PDRGate, errores fuera de la lista congelada **[PROPUESTA]**: `InvalidTier` (nivel distinto de 1 o 3), `OnlySafe` (configuración llamada por alguien que no es la Safe), `ZeroAddress` (dirección cero en el constructor, `setPolicySigner` o `setCosigner`), `SignerIsCosigner` (firmante de política igual al cosignatario en el constructor o en un setter) y `ExecutionFailed` (el Roles devolvió `false` en vez de revertir).
* Desde el 15 de octubre, los errores y eventos que comparten los dos gates (`IntentMismatch`, `CalldataMismatch`, `BadPolicySignature`, `MissingCosignature`, `StalePolicy`, `Expired`, `NonceUsed`, `GateIsPaused`, `GatePaused`, los cinco errores de arriba y `GateUnpaused`, `PolicySignerSet`, `PolicyHashSet`, `CosignerSet`) se declaran en `contracts/src/IPDRVerifier.sol`, que `IPDRGate` hereda. Los nombres y el ABI compilado de PDRGate no cambian; quien decodifique errores por nombre calificado en Solidity usa `IPDRVerifier.X`.

**Trade (agregado):**

* Gate de Trade (`FundingGate`), eventos: `FundingExecuted(intentHash, pdrHash, tier, orderId)`, `GatePaused`, `GateUnpaused`, `PolicySignerSet`, `PolicyHashSet`, `CosignerSet` y los del registro de confianza: `ChangeQueued(changeId, kind, subject, payout, roles, activatesAt)` (`kind` 1 = proveedor, con `subject` = exportador y `payout`; 2 = tercero, con `subject` = la dirección y `roles` = máscara NAVIERA 1, ÁRBITRO 2, VERIFICADOR 4), `ChangeVetoed(changeId, by)`, `SupplierRemoved(exporter, payout)` y `ThirdPartyRemoved(party, roles)`. No hay `OperationHeld`: una operación retenida nunca llega a la cadena (estados `HOLD_STATES`, fuera de la cadena).
* Gate de Trade, errores: los compartidos con PDRGate salvo `InvoiceAlreadyPaid` (la idempotencia está en el escrow: una orden solo se deposita desde Abierto), más **[PROPUESTA]** `OrderMismatch` (la intención o la orden guardada no coinciden: escrow, token, `orderHash` o monto), `OrderNotOpen` (la orden no está Abierta), `NotOwnOrder` (el importador no es esta Safe), `UnknownSupplier` (el par exportador y `payoutAddress` no está activo), `UntrustedParty` (naviera, árbitro o verificador no activos con ese rol), `AllowanceNotConsumed` (queda una aprobación al escrow después de `fund`), `OnlySafeOrCosigner`, `ChangeNotPending`, `AlreadyRegistered`, `NotRegistered`, `InvalidRoles`, `InvalidDelay` (`configDelay` menor que `MIN_CONFIG_DELAY`, 60 segundos) y `SameRoleKey`. Las listas exactas, con los heredados de OpenZeppelin, están en `GATE_EVENTS` y `GATE_ERRORS` de `schemas/src/index.ts`, y `engine/src/fundingGate.test.ts` las compara con el ABI compilado.
* TradeEscrow, eventos: `OrderOpened`, `OrderFunded`, `AdvanceReleased`, `ShipmentAccepted`, `BalanceReleased`, `Refunded`, `DisputeRaised`, `DisputeResolved`, `OrderCancelled`.
* TradeEscrow, errores: `InvalidState`, `OrderExists`, `BadImporterSignature`, `BadExporterSignature`, `BadCarrierSignature`, `BadDocumentDecision`, `ShipmentTooLate`, `BillOfLadingAlreadyUsed`, `DeadlineNotReached`, `NotParty`, `BadResolution`, `TokenNotAllowed`, `AmountMismatch`, `ZeroAddress`, `InvalidOrder`, `BadOrderId`, `DeadlinePassed`, `InvalidAttestation`, `BadArbiterSignature`.
* Errores agregados por el Área 1 al implementar TradeEscrow (14 de octubre): `ZeroAddress` (token en cero en el constructor), `InvalidOrder` (la orden no pasa los controles de forma de `open`: direcciones en cero, roles repetidos, anticipo mayor a 100%, monto cero o fecha límite pasada), `BadOrderId` (el `orderId` no es `keccak256(abi.encode(importer, exporter, nonce))`), `DeadlinePassed` (depósito en o después de la fecha límite de embarque), `InvalidAttestation` (atestación de otra orden o con fecha *on board* en el futuro) y `BadArbiterSignature` (la resolución no la firma el árbitro de la orden). La lista está en `ESCROW_ERRORS` de `schemas/src/index.ts`.
* `BalanceReleased` lleva el digest EIP-712 de lo que autorizó el pago: el `DocumentDecision` (`releaseBalance`) o la `BalanceApproval` del importador (`approveBalance`). `AdvanceReleased` se emite dentro de `fund`, junto con `OrderFunded`.
