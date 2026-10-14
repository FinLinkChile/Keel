---
type: Interfaz
title: "Datos firmados e interfaz de TradeEscrow"
description: "Structs PurchaseOrder y ShipmentAttestation campo por campo, y la tabla de funciones del contrato con quién llama y qué transición produce."
tags: [purchase-order, shipment-attestation, trade-escrow, eip-712, solidity]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

# Structs firmados

```solidity
struct PurchaseOrder {
    bytes32 orderId;            // identificador único
    address importer;           // billetera o Safe de la empresa importadora
    address exporter;           // billetera o Safe de la empresa exportadora
    address payoutAddress;      // dónde cobra el exportador: fijado aquí, firmado por ambos
    address token;              // stablecoin del pago
    uint256 totalAmount;        // monto total, en unidades mínimas del token
    uint16  advanceBps;         // anticipo en puntos básicos: 5000 = 50%
    uint64  shipmentDeadline;   // fecha límite de embarque ("on board")
    uint64  disputeWindow;      // segundos de la ventana de disputa tras el embarque
    address carrier;            // quién puede firmar la atestación de embarque
    address arbiter;            // árbitro acordado
    address documentVerifier;   // quién firma el DocumentDecision; nunca una parte ni la naviera
    bytes32 incoterm;           // EXW, FOB, CIF, CFR...
    bytes32 termsHash;          // hash EIP-712 de OrderTerms (términos estructurados de la orden)
    bytes32 requiredDocsHash;   // hash de la lista de documentos exigidos
    uint256 nonce;              // evita reutilizar la firma
}

struct ShipmentAttestation {
    bytes32 orderId;        // a qué orden corresponde
    bytes32 blNumberHash;   // hash del número de BL
    uint64  onBoardDate;    // fecha de embarque real
    bytes32 portOfLoading;  // puerto de carga
    bytes32 docsHash;       // hash del paquete de documentos
}
```

# Funciones

| Función | Quién llama | Transición |
| --- | --- | --- |
| `open(po, sigImporter, sigExporter)` | Cualquiera | nada a Abierto |
| `fund(orderId)` / `fundWithPermit(...)` | Importador | Abierto a Depositado |
| `releaseAdvance(orderId)` | Cualquiera | Depositado a AnticipoPagado |
| `submitShipment(orderId, att, sigCarrier)` | Cualquiera | AnticipoPagado a Embarcado: registra la atestación de la naviera |
| `releaseBalance(orderId, decision, sigVerifier)` o `releaseBalance(orderId, approval, sigImporter)` | Cualquiera | Embarcado a Liquidado, con el `DocumentDecision` del verificador o la `BalanceApproval` del importador |
| `refundAfterDeadline(orderId)` | Cualquiera | AnticipoPagado o Depositado a Reembolsado |
| `raiseDispute(orderId)` | Importador o exportador | a EnDisputa |
| `resolve(orderId, toImporter, toExporter, sigs)` | Cualquiera | EnDisputa a Resuelto |
| `cancel(orderId, sigImporter, sigExporter)` | Cualquiera | a Cancelado |

`BalanceApproval { bytes32 orderId; bytes32 attestationHash; }` la firma el importador para liberar el saldo sin `DocumentDecision` ([paso 5](paso-5-saldo.md)). Los nombres de las funciones de dos pasos son una propuesta para el Área 1.

Lo que `open` verifica está en el [paso 1](paso-1-firma-orden.md). Los eventos y errores tipados están en [eventos y errores](../interfaces/eventos-y-errores.md). Las intenciones (`FundIntent`) y las decisiones (`PolicyDecision`, `DocumentDecision`) están en [interfaces](../interfaces/index.md).
