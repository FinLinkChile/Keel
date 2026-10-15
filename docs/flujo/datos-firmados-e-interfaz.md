---
type: Interfaz
title: "Datos firmados e interfaz de TradeEscrow"
description: "Structs PurchaseOrder y ShipmentAttestation campo por campo, y la tabla de funciones del contrato con quién llama, desde qué estado y qué verifica."
tags: [purchase-order, shipment-attestation, trade-escrow, eip-712, solidity]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T20:30:00Z }
---

# Structs firmados

```solidity
struct PurchaseOrder {
    bytes32 orderId;            // keccak256(abi.encode(importer, exporter, nonce))
    address importer;           // billetera o Safe de la empresa importadora
    address exporter;           // billetera o Safe de la empresa exportadora
    address payoutAddress;      // dónde cobra el exportador: fijado aquí, firmado por ambos
    address token;              // stablecoin del pago
    uint256 totalAmount;        // monto total, en unidades mínimas del token
    uint16  advanceBps;         // anticipo en puntos básicos: 5000 = 50%
    uint64  shipmentDeadline;   // fecha límite de embarque ("on board")
    uint64  disputeWindow;      // segundos tras el embarque antes de que el verificador pueda liberar el saldo
    address carrier;            // quién puede firmar la atestación de embarque
    address arbiter;            // árbitro acordado
    address documentVerifier;   // quién firma el DocumentDecision
    bytes32 incoterm;           // EXW, FOB, CIF, CFR...
    bytes32 termsHash;          // hash EIP-712 de OrderTerms (términos estructurados de la orden)
    bytes32 requiredDocsHash;   // hash de la lista de documentos exigidos
    uint256 nonce;              // nuevo en cada versión de la orden
}

struct ShipmentAttestation {
    bytes32 orderId;        // a qué orden corresponde
    bytes32 blNumberHash;   // keccak256(abi.encode(carrier, número de BL)): único por naviera
    uint64  onBoardDate;    // fecha de embarque real
    bytes32 portOfLoading;  // puerto de carga
    bytes32 docsHash;       // hash del paquete de documentos
}
```

Los otros structs que firma alguien (`CancelOrder`, `BalanceApproval`, `DisputeResolution`, `DocumentDecision`) están en `contracts/src/KeelTypes.sol` y en [interfaces](../interfaces/index.md). Para `CancelOrder`, `BalanceApproval` y `DisputeResolution` el contrato arma el struct por dentro con lo que tiene guardado y solo recibe las firmas: no recibe de afuera lo que puede construir.

# Funciones

| Función | Quién llama | Desde | Hacia | Qué verifica |
| --- | --- | --- | --- | --- |
| `open(po, sigImporter, sigExporter)` | Cualquiera | nada | Abierto | Lo del [paso 1](paso-1-firma-orden.md) |
| `fund(orderId)` | Solo el importador | Abierto | AnticipoPagado | Antes de `shipmentDeadline`; recibe exactamente el total y paga el anticipo a `payoutAddress` en la misma transacción ([paso 2](paso-2-deposito.md), [paso 3](paso-3-anticipo.md)) |
| `submitShipment(orderId, att, sigCarrier)` | Cualquiera | AnticipoPagado | Embarcado | Solo mientras no se pueda reembolsar (`DeadlinePassed` desde `now > shipmentDeadline + refundGrace`, la misma comparación del reembolso); atestación de esta orden, firmada por la naviera, *on board* no anterior al depósito, no posterior a la fecha límite ni en el futuro, BL no usado por esa naviera ([paso 5](paso-5-saldo.md)) |
| `releaseBalance(orderId, d, sigVerifier)` | Cualquiera | Embarcado | Liquidado | Ventana de disputa cumplida y `DocumentDecision` del `documentVerifier` de la orden, vigente y sobre esta atestación |
| `approveBalance(orderId, sigImporter)` | Cualquiera | Embarcado | Liquidado | Firma del importador sobre `BalanceApproval{orderId, attestationHash}`, en cualquier momento |
| `refundAfterDeadline(orderId)` | Cualquiera | AnticipoPagado | Reembolsado | Pasó `shipmentDeadline + refundGrace` ([paso 6](paso-6-reembolso.md)) |
| `raiseDispute(orderId)` | Importador o exportador | Embarcado | EnDisputa | Sin límite de tiempo; desde AnticipoPagado revierte, para no bloquear un reembolso ([disputa y cancelación](disputa-y-cancelacion.md)) |
| `resolve(orderId, toImporter, toExporter, sigArbiter)` | Cualquiera | EnDisputa | Resuelto | Firma del árbitro; la suma es exactamente el saldo restante |
| `cancel(orderId, sigImporter, sigExporter)` | Cualquiera | Abierto, AnticipoPagado, EnDisputa | Cancelado | Firmas de ambas partes sobre `CancelOrder{orderId, cancelNonceOf(orderId)}` |

Vistas: `orderOf(orderId)` (la orden, su estado, `stateVersion`, `orderHash`, lo pagado, la atestación aceptada y si se depositó), `cancelNonceOf(orderId)` (el nonce que hay que firmar para cancelar ahora) e `isBlUsed(blKey)`.

No hay `releaseAdvance` (el anticipo sale dentro de `fund`) ni `fundWithPermit` (el depósito es `approve` exacto más `fund`, [decisión 7](../decisiones/abiertas.md)). El constructor es `TradeEscrow(token, refundGrace)`: un solo token permitido y sin firmante global ni administrador.

Los eventos y errores tipados están en [eventos y errores](../interfaces/eventos-y-errores.md). Las intenciones (`FundIntent`) y las decisiones (`PolicyDecision`, `DocumentDecision`) están en [interfaces](../interfaces/index.md).
