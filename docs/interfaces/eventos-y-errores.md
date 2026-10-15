---
type: Interfaz
title: "Eventos y errores tipados"
description: "Nombres fijos de los eventos y errores de PDRGate y de TradeEscrow, por modo."
tags: [eventos, errores, pdrgate, trade-escrow]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

**Personal (base):**

* PDRGate, eventos: `PaymentExecuted`, `PaymentHeld`, `BeneficiaryChangeQueued`, `BeneficiaryChangeVetoed`, `AgentRoleRevoked`, `GatePaused`.
* PDRGate, errores: `IntentMismatch`, `CalldataMismatch`, `BadPolicySignature`, `MissingCosignature`, `StalePolicy`, `Expired`, `NonceUsed`, `InvoiceAlreadyPaid`, `GateIsPaused`.

**Trade (agregado):**

* Gate de Trade, eventos: `FundingExecuted`, `OperationHeld`. Los errores son los mismos, salvo `InvoiceAlreadyPaid`, que no aplica.
* TradeEscrow, eventos: `OrderOpened`, `OrderFunded`, `AdvanceReleased`, `ShipmentAccepted`, `BalanceReleased`, `Refunded`, `DisputeRaised`, `DisputeResolved`, `OrderCancelled`.
* TradeEscrow, errores: `InvalidState`, `OrderExists`, `BadImporterSignature`, `BadExporterSignature`, `BadCarrierSignature`, `BadDocumentDecision`, `ShipmentTooLate`, `BillOfLadingAlreadyUsed`, `DeadlineNotReached`, `NotParty`, `BadResolution`, `TokenNotAllowed`, `AmountMismatch`.
