---
type: Paso del flujo
title: "Paso 2: depósito y bloqueo"
description: "El importador deposita el total en el escrow y el anticipo sale en la misma transacción: qué queda bloqueado, cómo se aprueba el token y por qué el exportador puede confiar."
tags: [paso-2, deposito, fund, approve, funding-gate, proveedores-conocidos]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T16:30:00Z }
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

# Qué verifica el gate de Trade antes de depositar

El agente no llama al escrow: el gate de Trade (`FundingGate`), único miembro de los roles del agente en el Roles de la Safe del importador, ejecuta `approve` exacto y `fund` en la misma transacción, solo si:

- El PDR firmado por el motor ata esta intención (`IntentMismatch`) y el calldata exacto que arma el propio gate (`CalldataMismatch`), con la versión de política vigente, sin vencer y con un nonce nuevo. En nivel 3 además trae la cofirma.
- La intención es para este escrow y este token, y la orden está Abierta, es exactamente la firmada (`orderHash`), por el monto total, y su importador es esta Safe (`OrderMismatch`, `OrderNotOpen`, `NotOwnOrder`).
- El par (exportador, `payoutAddress`) es un **proveedor conocido** de esta Safe (`UnknownSupplier`) y la naviera, el árbitro y el verificador de documentos de la orden son **terceros de confianza** de esta Safe con ese rol (`UntrustedParty`). Solo cuenta lo que ya se activó.
- Después de `fund` no queda aprobación al escrow (`AllowanceNotConsumed`).

En nivel 1 ejecuta con el rol AGENTE y en nivel 3 con el rol de cupo mayor (`AGENT_COSIGNED`); la cofirma solo cambia el cupo, nunca salta los registros.

**Registros de la Safe [PROPUESTA del Área 1].** Agregar un proveedor o un tercero lo encola la Safe y cuenta recién después de `configDelay` (120 segundos en la demo, 48 horas en producción), que hace cumplir el propio gate. Durante la espera la Safe o el cosignatario pueden vetar ese cambio en particular, sin afectar otros; el cosignatario solo puede quitar, nunca agregar. Quitar es inmediato. Así, ni la llave de política ni la del cosignatario, aunque se roben juntas, logran depositar a una cuenta de cobro o con terceros que la empresa no aprobó (pruebas `test_goal_*` y `testFuzz_fundingImpliesActiveSupplier` de `contracts/test/FundingGate.t.sol`). No protege contra los propios dueños de la Safe: pueden encolar y esperar; la defensa es el aviso y el veto.

Quién origina el depósito y con qué nivel está en [niveles de permiso](../arquitectura/niveles-de-permiso.md).
