---
type: Paso del flujo
title: "Paso 5, gatillo 2: saldo"
description: "Qué verifica submitShipment, los dos caminos para liberar el saldo (releaseBalance tras la ventana, approveBalance en cualquier momento), qué compara el motor para el DocumentDecision y cómo opera la ventana de disputa."
tags: [paso-5, saldo, gatillo-2, submit-shipment, release-balance, approve-balance, pdr]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T21:00:00Z }
---

El gatillo 2 tiene dos pasos: primero se registra el embarque y después se libera el saldo.

# Paso A: registrar el embarque (`submitShipment`)

El contrato verifica, en este orden:

1. Que la orden esté en AnticipoPagado (`InvalidState`). Se registra una sola vez: después ya está en Embarcado o en un estado posterior.
2. Que todavía no se pueda reembolsar (`DeadlinePassed` si `now > shipmentDeadline + refundGrace`). Es exactamente la comparación de `refundAfterDeadline`: en cada segundo es posible uno de los dos, nunca ambos ni ninguno.
3. Que la atestación corresponda a esta orden (`InvalidAttestation`).
4. Que la firma sea válida y venga de la naviera fijada en la orden (`BadCarrierSignature`).
5. Que la fecha *on board* sea igual o anterior a la fecha límite de embarque (`ShipmentTooLate`), no esté en el futuro y no sea anterior al momento del depósito (`InvalidAttestation`): un embarque previo al depósito no prueba que se cumplió esta orden.
6. Que esa naviera no haya usado ese BL en otra orden (`BillOfLadingAlreadyUsed`). La clave es `keccak256(abi.encode(naviera de la orden, blNumberHash))`, así una naviera no puede bloquear el BL de otra.

La orden pasa a Embarcado. No se mueve dinero y desde aquí no hay reembolso por vencimiento.

**Reglas para la naviera y el motor:** `onBoardDate` es un timestamp, no un día. Un BL dice solo la fecha; si la naviera firma las 00:00 de ese día y el depósito fue más tarde el mismo día, el escrow rechaza la atestación (`InvalidAttestation`). La naviera firma un instante no anterior al depósito ni posterior a la fecha límite, y el motor, que compara días, no lo rechaza por eso. La atestación tiene que llegar a la cadena antes de `shipmentDeadline + refundGrace`: el margen de gracia es también el último plazo para registrar el embarque ([paso 6](paso-6-reembolso.md)).

**Riesgo declarado:** si el importador deposita muy cerca de la fecha límite, la ventana válida de *on board* (entre el depósito y la fecha límite) se achica, y un embarque cargado antes del depósito no se puede atestar. El exportador conserva el anticipo y el saldo vuelve al importador por vencimiento.

# Paso B: liberar el saldo

El saldo (`totalAmount` menos el anticipo) va a `payoutAddress` por uno de dos caminos:

| Camino | Quién firma | Cuándo | Qué verifica |
| --- | --- | --- | --- |
| `releaseBalance(orderId, d, sigVerifier)` | El `documentVerifier` de la orden | Solo cuando se cumplió `shippedAt + disputeWindow` (`DeadlineNotReached`) | El `DocumentDecision` es de esta orden, de esta atestación y de este paquete de documentos, no venció y lo firma el verificador (`BadDocumentDecision`) |
| `approveBalance(orderId, sigImporter)` | El importador (EOA o Safe con ERC-1271) | En cualquier momento | Firma sobre `BalanceApproval{orderId, attestationHash}`, que el contrato arma con la atestación guardada (`BadImporterSignature`) |

Si ninguno de los dos llega, cualquiera de las partes puede abrir una disputa sin límite de tiempo y decide el árbitro ([disputa y cancelación](disputa-y-cancelacion.md)). Así ningún firmante caído deja el saldo atrapado.

# Qué compara el motor para el `DocumentDecision`

| Dato extraído | Contra qué se compara |
| --- | --- |
| Número de BL o de guía aérea | El de la atestación firmada por la naviera |
| Fecha *on board* | La de la atestación y la fecha límite de la orden |
| Monto de la factura | El monto de la orden |
| Partes | Importador y exportador de la orden |
| Mercancía | La descrita en la orden |

El número de orden, el monto y la moneda de la factura y los códigos arancelarios salen de `OrderTerms`, los términos que ambas partes firmaron a través de `termsHash` ([paso 1](paso-1-firma-orden.md)). Si faltan o no son los firmados, el motor no firma y el saldo se retiene.

# Decisión del motor: obligatoria, con dos salidas

Decidido por las Áreas 1 y 2 el 14 de octubre (decisión 3), a propuesta del Área 2. El saldo se libera solo con un `DocumentDecision` válido o con la aprobación manual del importador. Así, liberar el saldo exige siempre dos firmas independientes: la de la naviera y la del verificador de documentos (o la del propio importador, que es quien paga).

* **Quién firma:** el `documentVerifier` que fija cada orden, firmado por ambas partes. No puede ser el importador, el exportador, `payoutAddress`, la naviera ni el árbitro; el contrato solo detecta la misma dirección exacta, y exigir que sea la llave de Keel le corresponde al motor y al gate. En el prototipo es la llave de política del motor de Keel; en producción, quien las partes acuerden. El escrow no tiene un firmante global ni un administrador que lo cambie.
* **Salida 1, aprobación del importador:** si el motor no puede leer el BL o el servicio no responde, el importador firma una `BalanceApproval` sobre esa atestación y el saldo se libera de inmediato.
* **Salida 2, sin reembolso con embarque probado:** una orden en Embarcado ya no se reembolsa por vencimiento. Si el motor retiene y el importador no aprueba, cualquiera de las partes abre una disputa y decide el árbitro. Así un error de lectura nunca le quita el saldo a un exportador que sí embarcó.

El struct `DocumentDecision` está en [PDR](../interfaces/pdr.md).

# Ventana de disputa

`disputeWindow` lo fija cada orden, en segundos. Es el plazo mínimo entre el embarque y el momento en que el verificador puede liberar el saldo: le da al importador tiempo para revisar y, si algo no calza, abrir una disputa antes de que el saldo salga. El importador puede renunciar a la ventana firmando `approveBalance`. Con `disputeWindow = 0`, el verificador puede liberar apenas se registra el embarque.

Decidido por el Área 1 (Adrean) el 14 de octubre ([decisión 4](../decisiones/abiertas.md)): sin valor fijo en el contrato; la app sugiere 3 días y la demo usa 2 minutos.
