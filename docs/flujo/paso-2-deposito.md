---
type: Paso del flujo
title: "Paso 2: depósito y bloqueo"
description: "El importador deposita el total en el escrow: qué queda bloqueado, cómo se aprueba el token y por qué el exportador puede confiar."
tags: [paso-2, deposito, fund, permit]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

El importador transfiere `totalAmount` al contrato. Desde ese momento:

- El importador ya no puede retirar: el contrato no tiene ninguna función de retiro unilateral.
- El exportador todavía no recibe nada, pero puede leer en la cadena que el dinero existe.

La aprobación del token debe ser exacta, nunca ilimitada. Si el token soporta `permit` (EIP-2612), aprobación y depósito van en una sola transacción. **[ABIERTO: depende del token y de la red cerrada que se elijan]**

# Cómo se hace técnicamente

- Opción A: `approve(escrow, totalAmount)` y luego `fund(orderId)`, que llama `transferFrom`. La aprobación debe ser **exacta**, nunca ilimitada.
- Opción B (preferible): USDC soporta firmas de permiso (EIP-2612 `permit`), así que aprobación y depósito pueden ir en una sola transacción, sin dejar aprobaciones colgando. **[ABIERTO: confirmar soporte de permit en el USDC de la red elegida]**

# Por qué el exportador puede confiar

Cualquiera puede leer en la cadena que el contrato tiene el saldo y que la orden está en estado DEPOSITADO. El código del escrow no tiene ninguna función que le permita al importador retirar fondos fuera de las transiciones de la máquina de estados.

# Qué verificar en el contrato

Que el saldo recibido sea exactamente `totalAmount` (comparando el saldo antes y después, por si el token cobrara comisiones) y que solo el importador de la orden pueda depositar.

Quién origina el depósito y con qué nivel está en [niveles de permiso](../arquitectura/niveles-de-permiso.md). El soporte de `permit` es la [decisión abierta 7](../decisiones/abiertas.md).
