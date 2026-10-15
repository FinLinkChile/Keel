---
type: Decisiones
title: "Decisiones abiertas"
description: "Las 15 preguntas que el equipo todavía no cierra. Si un componente toca alguna, se decide con el equipo antes de escribir código."
tags: [decisiones-abiertas, pendiente]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T16:00:00Z }
---

No resolver ninguna por cuenta propia. Cuando el equipo cierra una, se actualiza primero el concepto afectado, luego esta tabla y después el código. Los números son estables: el código y los README los citan.

| # | Pregunta | Quién decide | Concepto afectado |
| --- | --- | --- | --- |
| 1 | ¿Qué red cerrada se usa (por ejemplo FISCO BCOS) y qué token de pago existe en ella? De esto depende si Safe, Zodiac Roles y Delay se pueden desplegar ahí tal como están | Equipo y Contratos, miércoles 14 | [Sistema de pago](../pagos/sistema-de-pago.md), [stack](../arquitectura/stack.md) |
| 2 | ¿El anticipo se libera en la misma transacción del depósito? | Contratos | [Paso 3](../flujo/paso-3-anticipo.md) |
| 3 | **Decidida el 14 de octubre por las Áreas 1 y 2.** El `DocumentDecision` es obligatorio, con dos salidas: el importador puede aprobar el saldo a mano (`BalanceApproval`) y con una atestación registrada no hay reembolso automático. Lo firma el `documentVerifier` fijado en cada orden, que no es ninguna de las partes ni la naviera. Detalle en el [paso 5](../flujo/paso-5-saldo.md). | Motor y Contratos | [Paso 5](../flujo/paso-5-saldo.md), [PDR](../interfaces/pdr.md) |
| 4 | ¿Se usa ventana de disputa por defecto? ¿De cuántos días? | Equipo | [Paso 5](../flujo/paso-5-saldo.md) |
| 5 | ¿La disputa la resuelve el árbitro solo o 2 de 3? | Equipo | [Disputa y cancelación](../flujo/disputa-y-cancelacion.md) |
| 6 | ¿Cuánto dura el margen de gracia entre la fecha límite de embarque y el reembolso? | | [Paso 6](../flujo/paso-6-reembolso.md) |
| 7 | ¿El token elegido soporta `permit`? | Contratos | [Paso 2](../flujo/paso-2-deposito.md) |
| 8 | ¿Se admite pago diferido (por ejemplo, saldo a 30 días desde la fecha *on board*, como en el caso marítimo de la entrevista)? | | [Paso 5](../flujo/paso-5-saldo.md) |
| 9 | ¿Se confirman los niveles de permiso propuestos para Keel Trade? | | [Niveles de permiso](../arquitectura/niveles-de-permiso.md) |
| 10 | ¿Estado actual de la regulación de stablecoins en Hong Kong y de cripto en China? | Red Team y Evidencia, antes del deck | [Regulación](../pagos/regulacion.md) |
| 11 | ¿Se puede citar al importador entrevistado, aunque sea de forma anónima? | Quien hizo la entrevista, antes del deck | [Entrevista](../contexto/entrevista-importador.md) |
| 12 | ¿Se confirman las tareas, las interfaces y el calendario propuestos tras el cambio de rumbo? | | [Trabajo](../trabajo/index.md), [interfaces](../interfaces/index.md) |
| 13 | ¿Cómo verifica el jurado las transacciones si la red es cerrada? | | [Entregables](../entrega/entregables.md) |
| 14 | Keel Personal vuelve al alcance: ¿con qué profundidad entra en la entrega (aplicación, contratos, demo) y en qué red y con qué token corre? | | [Keel Personal](../personal/keel-personal.md), [alcance](../flujo/alcance.md) |
| 15 | ¿Dónde viven la orden firmada, sus `OrderTerms`, los proveedores conocidos y el historial de montos por proveedor, y quién se los entrega al servicio del agente (T2.11)? Supuesto mientras tanto: archivos locales de la demo | Áreas 2, 3 y 4 | [Área 2](../trabajo/area-2-motor.md), [Área 4](../trabajo/area-4-producto.md) |

Una celda vacía en "quién decide" significa que las fuentes no lo asignan todavía.

# Otras cuestiones abiertas, registradas en su concepto

- Aprobación exacta más `fund`, o `fundWithPermit`: tarea T1.2 del [Área 1](../trabajo/area-1-contratos.md). Depende de la decisión 7.
- Qué actos de Keel Personal entran en el deck y en el video: [demo](../entrega/demo.md). Depende de la decisión 14.
- Dónde entra Keel Personal en el orden de recorte: [recortes](../trabajo/recortes.md). Depende de la decisión 14.
