---
type: Paso del flujo
title: "Paso 6: vencimiento y reembolso"
description: "Cuándo y cómo vuelve el saldo al importador si no hay prueba de embarque, y por qué cualquiera puede ejecutar el reembolso."
tags: [paso-6, reembolso, vencimiento, refund]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T21:00:00Z }
---

**Condición:** pasó `shipmentDeadline` más un margen de gracia y no hay atestación válida registrada. Una orden en Embarcado (atestación registrada, saldo todavía no liberado) no se reembolsa por vencimiento: se resuelve con el `DocumentDecision`, la aprobación del importador o una disputa ([paso 5](paso-5-saldo.md)).

**Efecto:** el saldo no liberado vuelve al importador.

Desde el primer segundo en que el reembolso es posible, ya no se puede registrar un embarque (`submitShipment` usa la misma comparación) y no hay disputa que lo bloquee: la disputa solo se abre desde Embarcado ([disputa y cancelación](disputa-y-cancelacion.md)). Para el exportador, el margen de gracia es el último plazo para que la atestación llegue a la cadena: una atestación de un embarque a tiempo que se mina después pierde el saldo.

Cualquiera puede ejecutar el reembolso. Es intencional: el importador no depende de nadie para recuperar su dinero. Los plazos se miden en días u horas, nunca en segundos.

**Detalle técnico:** las fechas se comparan con `block.timestamp`, que el productor del bloque puede mover unos segundos. Por eso los plazos se miden en días u horas, nunca en segundos, y el margen de gracia absorbe cualquier ajuste.

El margen de gracia es `refundGrace`, un parámetro del despliegue del escrow: 1 día en producción y 60 segundos en la demo. Decidido por el Área 1 (Adrean) el 14 de octubre ([decisión 6](../decisiones/abiertas.md)).
