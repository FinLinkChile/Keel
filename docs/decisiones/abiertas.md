---
type: Decisiones
title: "Decisiones abiertas"
description: "Las 17 preguntas que el equipo todavía no cierra. Si un componente toca alguna, se decide con el equipo antes de escribir código."
tags: [decisiones-abiertas, pendiente]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T16:00:00Z }
---

No resolver ninguna por cuenta propia. Cuando el equipo cierra una, se actualiza primero el concepto afectado, luego esta tabla y después el código. Los números son estables: el código y los README los citan.

| # | Pregunta | Quién decide | Concepto afectado |
| --- | --- | --- | --- |
| 1 | ¿Qué red cerrada se usa (por ejemplo FISCO BCOS) y qué token de pago existe en ella? De esto depende si Safe, Zodiac Roles y Delay se pueden desplegar ahí tal como están | Equipo y Contratos, miércoles 14 | [Sistema de pago](../pagos/sistema-de-pago.md), [stack](../arquitectura/stack.md) |
| 2 | **Decidida el 14 de octubre (Área 1, Adrean).** Sí: `fund` recibe el total y paga el anticipo en la misma transacción, sin estado Depositado. Elimina la carrera entre liberar el anticipo y una cancelación ya firmada. | Contratos | [Paso 3](../flujo/paso-3-anticipo.md) |
| 3 | **Decidida el 14 de octubre por las Áreas 1 y 2.** El `DocumentDecision` es obligatorio, con dos salidas: el importador puede aprobar el saldo a mano (`BalanceApproval`, función `approveBalance`, en cualquier momento) y con una atestación registrada no hay reembolso automático. `releaseBalance` con el `DocumentDecision` se puede llamar solo después de la ventana de disputa. Lo firma el `documentVerifier` fijado en cada orden, que no es ninguna de las partes ni la naviera. Detalle en el [paso 5](../flujo/paso-5-saldo.md). | Motor y Contratos | [Paso 5](../flujo/paso-5-saldo.md), [PDR](../interfaces/pdr.md) |
| 4 | **[PROPUESTA] Decidida por el Área 1 (Adrean) el 14 de octubre, falta que el equipo la confirme.** `disputeWindow` lo fija cada orden, sin valor por defecto en el contrato; la app sugiere 3 días y la demo usa 2 minutos. | Equipo | [Paso 5](../flujo/paso-5-saldo.md) |
| 5 | **[PROPUESTA] Decidida por el Área 1 (Adrean) el 14 de octubre, falta que el equipo la confirme.** Resuelve el árbitro solo; las partes pueden salir de la disputa cancelando de mutuo acuerdo. 2 de 3 queda como trabajo futuro. | Equipo | [Disputa y cancelación](../flujo/disputa-y-cancelacion.md) |
| 6 | **[PROPUESTA] Decidida por el Área 1 (Adrean) el 14 de octubre, falta que el equipo la confirme.** `refundGrace` es un parámetro del despliegue del escrow: 1 día en producción, 60 segundos en la demo. | Contratos | [Paso 6](../flujo/paso-6-reembolso.md) |
| 7 | **Decidida el 14 de octubre (Área 1, Adrean).** El depósito es `approve` exacto más `fund`, sin `fundWithPermit`: no está verificado que el USDC de la red acepte `permit` firmado por una Safe con ERC-1271, y así funciona con cualquier token. | Contratos | [Paso 2](../flujo/paso-2-deposito.md) |
| 8 | ¿Se admite pago diferido (por ejemplo, saldo a 30 días desde la fecha *on board*, como en el caso marítimo de la entrevista)? | | [Paso 5](../flujo/paso-5-saldo.md) |
| 9 | ¿Se confirman los niveles de permiso propuestos para Keel Trade? | | [Niveles de permiso](../arquitectura/niveles-de-permiso.md) |
| 10 | ¿Estado actual de la regulación de stablecoins en Hong Kong y de cripto en China? | Red Team y Evidencia, antes del deck | [Regulación](../pagos/regulacion.md) |
| 11 | ¿Se puede citar al importador entrevistado, aunque sea de forma anónima? | Quien hizo la entrevista, antes del deck | [Entrevista](../contexto/entrevista-importador.md) |
| 12 | ¿Se confirman las tareas, las interfaces y el calendario propuestos tras el cambio de rumbo? | | [Trabajo](../trabajo/index.md), [interfaces](../interfaces/index.md) |
| 13 | ¿Cómo verifica el jurado las transacciones si la red es cerrada? | | [Entregables](../entrega/entregables.md) |
| 14 | Keel Personal vuelve al alcance: ¿con qué profundidad entra en la entrega (aplicación, contratos, demo) y en qué red y con qué token corre? | | [Keel Personal](../personal/keel-personal.md), [alcance](../flujo/alcance.md) |
| 15 | ¿Dónde viven la orden firmada, sus `OrderTerms`, los proveedores conocidos y el historial de montos por proveedor, y quién se los entrega al servicio del agente (T2.11)? Supuesto mientras tanto: archivos locales de la demo. Los proveedores conocidos y los terceros de confianza ya viven en el FundingGate y el agente los lee de ahí. **[PROPUESTA] en la rama `AWS`:** las órdenes y el historial viven en DynamoDB; la Lambda de alta de orden las registra cuando la propuesta tiene las dos firmas y el agente llama `open` en su vuelta ([despliegue en AWS](../arquitectura/despliegue-aws.md)). Los archivos de la demo siguen funcionando con `keel agent` | Áreas 2, 3 y 4 | [Área 2](../trabajo/area-2-motor.md), [Área 4](../trabajo/area-4-producto.md) |
| 16 | En un depósito de nivel 3, ¿cómo le llega al agente la firma del cosignatario sobre el `pdrHash` (vista del cosignatario, T4.5) para que envíe `execute` con ella? ¿Quién la envía si el PDR vence antes? Supuesto mientras tanto: el agente se detiene en `en_aprobacion` con el PDR firmado en la evidencia y el acto 1 usa nivel 1 | Áreas 2 y 4 | [Servicio del agente](../arquitectura/servicio-del-agente.md) |

Una celda vacía en "quién decide" significa que las fuentes no lo asignan todavía.

# Otras cuestiones abiertas, registradas en su concepto

- Qué actos de Keel Personal entran en el deck y en el video: [demo](../entrega/demo.md). Depende de la decisión 14.
- Quién mantiene el registro de órdenes de ingesta (quién puede subir documentos a cada orden y cuáles son las cuentas registradas del exportador) y si debería leerse de los eventos `OrderOpened` del escrow. Supuesto actual del Área 3: un archivo que entrega el Área 4. Ver [carga de documentos](../interfaces/carga-de-documentos.md).
- Dónde entra Keel Personal en el orden de recorte: [recortes](../trabajo/recortes.md). Depende de la decisión 14.
| 17 | **Decidida el 18 de octubre (Área 2, Darienn).** `TradeEscrow.open` la envía el relayer del Servicio del agente (Área 2), que paga el gas. `open` no pide permiso y no da autoridad a quien la envía, porque la autoridad son las firmas del importador y del exportador. El Área 4 produce esas firmas y las entrega junto a la orden (`order.json`); el agente solo abre órdenes de su Safe. Es la misma separación de poderes de los demás pasos: la interfaz firma, el motor y el relayer ejecutan. | Área 2 | [Servicio del agente](../arquitectura/servicio-del-agente.md), [Área 2](../trabajo/area-2-motor.md), [Paso 1](../flujo/paso-1-firma-orden.md) |
