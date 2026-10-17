---
type: Decisiones
title: "Decisiones transversales D1 a D14"
description: "Lo que ya se definió para todas las áreas y nadie cambia sin avisar al equipo. Cada decisión con su motivo."
tags: [decisiones, d1-d14]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T16:30:00Z }
---

| # | Decisión | Por qué |
|---|---|---|
| D1 | El proyecto se llama **Keel** en código, documentos, repositorio y deck. No queda ninguna mención a "Leash". | Hay un repositorio competidor del mismo tema con ese nombre. |
| D2 | **No hay LLM operativo.** El flujo queda así: extractor LLM en cuarentena, validador determinista, motor de política, PDR, contrato. Si existe un chat, es de solo lectura (nivel 0) y explica decisiones con plantillas. | Crítica 8: el motor ya es determinista y ese LLM solo agrega superficie de ataque. |
| D3 | **El esquema de extracción no tiene texto libre.** Solo enums, números y campos validados con expresiones regulares. | Crítica 8. |
| D4 | **El gate es el único miembro del rol del agente** en el Roles Modifier de cada Safe: PDRGate en Keel Personal y el gate de Trade en Keel Trade (un gate por modo, ver [PDR](../interfaces/pdr.md)). La llave del agente sola no puede mover fondos: solo sirve para pagar gas. | Sin esto, el PDR no se exige en cadena. |
| D5 | **Los cambios de configuración pasan por el Delay Modifier:** lista blanca de beneficiarios (Personal), cupos, firmante de la política y miembros de roles. Tienen aviso y ventana de veto. **[PROPUESTA del Área 1, 15 de octubre]** Los proveedores conocidos y terceros de confianza de Trade (naviera, árbitro, verificador) no van por el Delay: los registra `FundingGate` con su propia espera (`configDelay`) y veto por cambio, de la Safe o del cosignatario. | Hace verificable el nivel 2 y responde a la crítica 16. En Trade, el veto del Delay (`setTxNonce`) cancela todo lo pendiente en bloque y sin ConfigGuard los dueños pueden saltárselo; la espera del gate la hace cumplir el contrato que paga. |
| D6 | **El cosignatario no es dueño de la Safe.** Tiene un rol propio que solo le permite vetar, pausar y revocar el rol del agente. | Crítica 15: en una Safe, cualquier dueño puede proponer. |
| D7 | **La simulación en tiempo de ejecución es `eth_call`.** Anvil se usa solo para las pruebas. | Crítica 18. |
| D8 | **Fallar cerrado siempre avisa:** todo pago u operación retenida notifica el motivo, la fecha límite y la alternativa manual. | Crítica 19. |
| D9 | **Nada de sobreafirmaciones.** Ninguna celda dice "ninguno conocido" ni "imposible para cualquiera". Cada afirmación de seguridad dice para quién vale, dónde se hace cumplir y qué prueba lo demuestra. | Crítica 16. |
| D10 | Todo lo que se entrega al jurado va en inglés. El trabajo interno puede ir en español. | Bases del concurso. |
| D11 | **El objetivo del proyecto es el [flujo clave](../flujo/flujo-clave.md).** Se consulta antes de idear o crear un componente. | Cambio de rumbo del 13 de octubre. |
| D12 | **La cuenta de cobro nunca sale de un documento.** En Trade sale de la orden de compra firmada por ambas partes, y cambiarla exige una orden nueva. En Personal sale de la tabla de beneficiarios registrados, y cambiarla pasa por el Delay. | Es la defensa contra el fraude de cambio de cuenta. |
| D13 | **La prueba de embarque es una firma de un tercero, no un PDF.** La IA lee datos, no valida firmas. (Trade) | Una firma escaneada es una imagen. |
| D14 | **Quien frena o arbitra no puede cobrar.** El contrato de escrow solo paga al importador o a la cuenta de cobro de la orden. (Trade) | Extiende D6 al árbitro. |

Las críticas que se citan como motivo están en el [mapa de críticas](../trabajo/mapa-de-criticas.md).
