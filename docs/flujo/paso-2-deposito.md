---
type: Paso del flujo
title: "Paso 2: depósito y bloqueo"
description: "El importador deposita el total en el escrow y el anticipo sale en la misma transacción: qué queda bloqueado, cómo se aprueba el token y por qué el exportador puede confiar."
tags: [paso-2, deposito, fund, approve]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T01:40:00Z }
---

El importador transfiere `totalAmount` al contrato con `fund(orderId)`, y en la misma transacción el contrato paga el anticipo a `payoutAddress` ([paso 3](paso-3-anticipo.md)). La orden pasa de Abierto a AnticipoPagado. Desde ese momento:

- El importador ya no puede retirar: el contrato no tiene ninguna función de retiro unilateral.
- El exportador recibió el anticipo pactado y puede leer en la cadena que el resto del dinero existe.

# Cómo se hace técnicamente

`approve(escrow, totalAmount)` y luego `fund(orderId)`, que llama `transferFrom`. La aprobación debe ser **exacta**, nunca ilimitada. En Keel Trade el gate ejecuta las dos llamadas en la misma transacción desde la Safe del importador.

No se usa `permit` (EIP-2612): no está verificado que el USDC de la red elegida acepte firmas ERC-1271 de una Safe, y `approve` exacto más `fund` funciona con cualquier token. Decidido por el Área 1 (decisión 7).

# Por qué el exportador puede confiar

Cualquiera puede leer en la cadena que el contrato tiene el saldo y que la orden está en AnticipoPagado. El código del escrow no tiene ninguna función que le permita al importador retirar fondos fuera de las transiciones de la máquina de estados.

# Qué verifica el contrato

- Que solo el importador de la orden deposite (`NotParty`) y que la orden esté Abierta (`InvalidState`).
- Que no haya pasado la fecha límite de embarque (`DeadlinePassed`).
- Que el saldo recibido sea exactamente `totalAmount`, comparando el saldo antes y después por si el token cobrara comisiones (`AmountMismatch`). Esto se comprueba antes de que salga el anticipo.

Quién origina el depósito y con qué nivel está en [niveles de permiso](../arquitectura/niveles-de-permiso.md).
