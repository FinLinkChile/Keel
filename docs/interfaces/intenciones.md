---
type: Interfaz
title: "Intenciones: PaymentIntent y FundIntent"
description: "Structs de la intención de pago (Personal) y de la intención de depósito (Trade) que firma el motor dentro del PDR."
tags: [payment-intent, fund-intent, eip-712, solidity]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

**Personal (base).** Intención de pago:

```solidity
struct PaymentIntent {
    uint8   aliasId;        // enum de beneficiarios registrados
    address recipient;      // resuelto desde la tabla de alias, nunca desde el documento
    uint256 amountUsdc;     // 6 decimales
    bytes32 invoiceKey;     // keccak256(issuerTaxId, invoiceNumber, period)
    uint64  deadline;
    uint256 nonce;
}
```

**Trade (agregado).** Intención de depósito:

```solidity
struct FundIntent {
    bytes32 orderId;
    address escrow;         // el contrato TradeEscrow
    address token;
    uint256 amount;         // igual al totalAmount de la orden
    uint64  deadline;
    uint256 nonce;
}
```

La orden de compra (`PurchaseOrder`) y la atestación de embarque (`ShipmentAttestation`) están en [datos firmados e interfaz](../flujo/datos-firmados-e-interfaz.md).
