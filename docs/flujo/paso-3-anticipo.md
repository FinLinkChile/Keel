---
type: Paso del flujo
title: "Paso 3, gatillo 1: anticipo"
description: "Condición y efecto de la liberación del anticipo, por qué sale en la misma transacción del depósito y el riesgo que se mantiene si el exportador no embarca."
tags: [paso-3, anticipo, gatillo-1, fund]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T21:00:00Z }
---

**Condición:** la orden está firmada por ambas partes y el importador deposita el total.

**Efecto:** en la misma llamada `fund`, se transfiere `totalAmount * advanceBps / 10000` a `payoutAddress` y la orden queda en AnticipoPagado. Con `advanceBps = 0` no se transfiere nada y la orden igual pasa a AnticipoPagado.

# Por qué en la misma transacción

Decidido por el Área 1 (Adrean) el 14 de octubre, cierra la [decisión abierta 2](../decisiones/abiertas.md):

- El anticipo ya estaba pactado y firmado en la orden: no hay nada más que verificar entre el depósito y el anticipo.
- No queda un estado intermedio (antes llamado Depositado). Con ese estado, cualquiera podía liberar el anticipo justo antes de que llegara una cancelación firmada por ambas partes y dejarla sin efecto, porque la firma de cancelación queda atada al estado de la orden.

# Riesgo que se mantiene

El mismo de hoy: el anticipo sale antes del embarque. Si el exportador no embarca, el importador recupera el saldo por vencimiento ([paso 6](paso-6-reembolso.md)) y el anticipo no se recupera en la cadena: la disputa solo reparte el saldo restante y solo se abre después del embarque, así que queda para un acuerdo entre las partes fuera de la cadena. Las partes eligen ese riesgo al fijar `advanceBps` (con 0% no existe).
