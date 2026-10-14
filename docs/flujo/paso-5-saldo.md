---
type: Paso del flujo
title: "Paso 5, gatillo 2: saldo"
description: "Las siete verificaciones de submitShipment, qué compara el motor para emitir el PDR de documentos y cómo opera la ventana de disputa."
tags: [paso-5, saldo, gatillo-2, submit-shipment, pdr]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

El contrato verifica, en este orden:

1. Que la orden esté en el estado correcto.
2. Que la atestación corresponda a esta orden.
3. Que la firma sea válida y venga de la naviera fijada en la orden.
4. Que la fecha *on board* sea igual o anterior a la fecha límite de embarque.
5. Que ese número de BL no se haya usado en otra orden.
6. Que exista un PDR del motor que diga que los documentos cumplen lo pactado.
7. Que no haya una disputa abierta.

Lo que el motor compara para emitir ese PDR:

| Dato extraído | Contra qué se compara |
| --- | --- |
| Número de BL o de guía aérea | El de la atestación firmada por la naviera |
| Fecha *on board* | La de la atestación y la fecha límite de la orden |
| Monto de la factura | El monto de la orden |
| Partes | Importador y exportador de la orden |
| Mercancía | La descrita en la orden |

**Efecto:** se transfiere el saldo a `payoutAddress`. Si la orden tiene ventana de disputa, el saldo se libera al terminar la ventana, salvo que el importador abra una disputa.

**[ABIERTO]** Si el PDR del motor es obligatorio para liberar el saldo o solo informativo. Recomendación: obligatorio, porque es la parte del gatillo que valida BL y factura, y es lo que hace que el flujo sea de un agent wallet y no solo de un escrow.

El estado de origen es AnticipoPagado, o Depositado si el anticipo es 0%. La obligatoriedad del PDR es la [decisión abierta 3](../decisiones/abiertas.md); el struct de esa decisión (`DocumentDecision`) está en [PDR](../interfaces/pdr.md).

# Ventana de disputa

Si se configura `disputeWindow`, el saldo no se paga de inmediato: queda marcado como embarcado y se libera al terminar la ventana, salvo que el importador abra una disputa. Es un trade-off: más protección para el importador, cobro más lento para el exportador. Las partes lo eligen en la orden.

Si se usa por defecto y de cuántos días es la [decisión abierta 4](../decisiones/abiertas.md).
