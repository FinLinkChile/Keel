---
type: Máquina de estados
title: "Estados del escrow"
description: "Máquina de estados de TradeEscrow, reglas de transición y las cuatro invariantes que se prueban con fuzz."
tags: [estados, invariantes, trade-escrow, fuzz]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

```mermaid
stateDiagram-v2
    [*] --> Abierto: open (orden firmada por ambos)
    Abierto --> Depositado: fund (importador deposita el total)
    Depositado --> AnticipoPagado: releaseAdvance (gatillo 1)
    AnticipoPagado --> Embarcado: submitShipment (atestación de la naviera)
    Embarcado --> Liquidado: releaseBalance (gatillo 2: DocumentDecision o aprobación del importador)
    Embarcado --> EnDisputa: raiseDispute
    AnticipoPagado --> Reembolsado: refundAfterDeadline
    AnticipoPagado --> EnDisputa: raiseDispute
    EnDisputa --> Resuelto: resolve (firma del árbitro)
    Abierto --> Cancelado: cancel (firmas de ambos)
    Depositado --> Cancelado: cancel (firmas de ambos)
    AnticipoPagado --> Cancelado: cancel (firmas de ambos)
    Liquidado --> [*]
    Reembolsado --> [*]
    Resuelto --> [*]
    Cancelado --> [*]
```

# Reglas de la máquina

- Cada transición tiene un único estado de origen permitido. Cualquier otra llamada revierte con `InvalidState`.
- Liquidado, Reembolsado, Resuelto y Cancelado son finales: no se vuelve a mover dinero de esa orden.
- Embarcado no tiene salida por vencimiento: con el embarque probado, el saldo sale por el gatillo 2 o por una disputa ([decisión 3](../decisiones/abiertas.md)).

# Invariantes que se prueban con fuzz

1. Lo pagado en total nunca supera lo depositado.
2. Ningún fondo sale hacia una dirección que no sea `importer` o `payoutAddress`.
3. Un estado final nunca vuelve a mover fondos.
4. Un mismo BL nunca liquida dos órdenes.

La primera es la invariante principal. Las funciones que producen cada transición están en [datos firmados e interfaz](datos-firmados-e-interfaz.md).
