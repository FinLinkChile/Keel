---
type: Paso del flujo
title: "Paso 3, gatillo 1: anticipo"
description: "Condición y efecto de la liberación del anticipo, y el riesgo que se mantiene si el exportador no embarca."
tags: [paso-3, anticipo, gatillo-1, release-advance]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

**Condición:** la orden está firmada por ambas partes y el total está depositado.

**Efecto:** se transfiere `totalAmount * advanceBps / 10000` a `payoutAddress`.

El riesgo que se mantiene es el mismo de hoy: el anticipo sale antes del embarque. Si el exportador no embarca, el importador solo lo recupera por disputa. Las partes eligen ese riesgo al fijar `advanceBps` (con 0% no existe).

**[ABIERTO]** Si el anticipo se libera en la misma transacción del depósito (recomendado, no deja un estado intermedio) o en una llamada aparte.

Es la [decisión abierta 2](../decisiones/abiertas.md). La recomendación se apoya en que el anticipo ya estaba pactado y firmado.
