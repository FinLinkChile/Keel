---
type: Entrega
title: "Demo en cuatro actos"
description: "Los cuatro actos de la demo de Keel Trade, cada uno con hash real, y los cuatro de Keel Personal."
tags: [demo, actos, video, deck]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

# Keel Trade (demo principal, propuesta)

1. **Flujo feliz:** importador y exportador firman la orden, el agente deposita, sale el anticipo, la naviera atesta el embarque, el motor confirma BL y factura, sale el saldo.
2. **Los dos fraudes documentales:** llega un correo de "cambio de cuenta" y un BL fabricado. Se muestra que el extractor lee la cuenta falsa (la IA falla) y que nada cambia: la cuenta de cobro está firmada en la orden, y el BL sin firma de la naviera revierte.
3. **El proveedor no embarca:** pasa la fecha límite y el saldo vuelve al importador, sin depender de nadie.
4. **El robo directo:** con la llave del agente se intenta enviar fondos de la Safe a una dirección externa. El Roles Modifier revierte. Hash del revert en pantalla.

Cierre: tabla con N órdenes liquidadas, M ataques bloqueados, 0 fondos perdidos.

# Keel Personal

Los cuatro actos de Personal son: pago normal, factura fraudulenta, cambio legítimo de beneficiario y llave robada. **[ABIERTO]** Qué actos de Personal entran en el deck y en el video; depende de la [decisión abierta 14](../decisiones/abiertas.md).

El deck y el video son la tarea T5.7 del [Área 5](../trabajo/area-5-redteam-evidencia.md).
