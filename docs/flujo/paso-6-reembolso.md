---
type: Paso del flujo
title: "Paso 6: vencimiento y reembolso"
description: "Cuándo y cómo vuelve el saldo al importador si no hay prueba de embarque, y por qué cualquiera puede ejecutar el reembolso."
tags: [paso-6, reembolso, vencimiento, refund]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

**Condición:** pasó `shipmentDeadline` más un margen de gracia y no hay atestación válida.

**Efecto:** el saldo no liberado vuelve al importador.

Cualquiera puede ejecutar el reembolso. Es intencional: el importador no depende de nadie para recuperar su dinero. Los plazos se miden en días u horas, nunca en segundos.

**Detalle técnico:** las fechas se comparan con `block.timestamp`, que el productor del bloque puede mover unos segundos. Por eso los plazos se miden en días u horas, nunca en segundos, y el margen de gracia absorbe cualquier ajuste.

La duración del margen de gracia es la [decisión abierta 6](../decisiones/abiertas.md).
