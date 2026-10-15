---
type: Interfaz
title: "Eventos y errores tipados"
description: "Nombres fijos de los eventos y errores de PDRGate y de TradeEscrow, por modo."
tags: [eventos, errores, pdrgate, trade-escrow]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T01:40:00Z }
---

**Personal (base):**

* PDRGate, eventos: `PaymentExecuted`, `PaymentHeld`, `BeneficiaryChangeQueued`, `BeneficiaryChangeVetoed`, `AgentRoleRevoked`, `GatePaused`.
* PDRGate, errores: `IntentMismatch`, `CalldataMismatch`, `BadPolicySignature`, `MissingCosignature`, `StalePolicy`, `Expired`, `NonceUsed`, `InvoiceAlreadyPaid`, `GateIsPaused`.
* PDRGate, errores fuera de la lista congelada **[PROPUESTA]**, declarados en `PDRGate.sol` y no en `IPDRGate.sol`: `InvalidTier` (nivel distinto de 1 o 3), `OnlySafe` (configuración llamada por alguien que no es la Safe), `ZeroAddress` (dirección cero en el constructor, `setPolicySigner` o `setCosigner`), `SignerIsCosigner` (firmante de política igual al cosignatario en el constructor o en un setter) y `ExecutionFailed` (el Roles devolvió `false` en vez de revertir).

**Trade (agregado):**

* Gate de Trade, eventos: `FundingExecuted`, `OperationHeld`. Los errores son los mismos, salvo `InvoiceAlreadyPaid`, que no aplica.
* TradeEscrow, eventos: `OrderOpened`, `OrderFunded`, `AdvanceReleased`, `ShipmentAccepted`, `BalanceReleased`, `Refunded`, `DisputeRaised`, `DisputeResolved`, `OrderCancelled`.
* TradeEscrow, errores: `InvalidState`, `OrderExists`, `BadImporterSignature`, `BadExporterSignature`, `BadCarrierSignature`, `BadDocumentDecision`, `ShipmentTooLate`, `BillOfLadingAlreadyUsed`, `DeadlineNotReached`, `NotParty`, `BadResolution`, `TokenNotAllowed`, `AmountMismatch`, `ZeroAddress`, `InvalidOrder`, `BadOrderId`, `DeadlinePassed`, `InvalidAttestation`, `BadArbiterSignature`.
* Errores agregados por el Área 1 al implementar TradeEscrow (14 de octubre): `ZeroAddress` (token en cero en el constructor), `InvalidOrder` (la orden no pasa los controles de forma de `open`: direcciones en cero, roles repetidos, anticipo mayor a 100%, monto cero o fecha límite pasada), `BadOrderId` (el `orderId` no es `keccak256(abi.encode(importer, exporter, nonce))`), `DeadlinePassed` (depósito en o después de la fecha límite de embarque), `InvalidAttestation` (atestación de otra orden o con fecha *on board* en el futuro) y `BadArbiterSignature` (la resolución no la firma el árbitro de la orden). La lista está en `ESCROW_ERRORS` de `schemas/src/index.ts`.
* `BalanceReleased` lleva el digest EIP-712 de lo que autorizó el pago: el `DocumentDecision` (`releaseBalance`) o la `BalanceApproval` del importador (`approveBalance`). `AdvanceReleased` se emite dentro de `fund`, junto con `OrderFunded`.
