---
type: Arquitectura
title: "Evidencia y bitácora"
description: "Qué queda registrado de cada intento, dónde se guardan los PDR y por qué los reverts deliberados son la evidencia más fuerte."
tags: [evidencia, bitacora, pdr, hash]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

Cada intento queda registrado con estado (ejecutado, retenido por el motor, revertido por el contrato), motivo, hash de los documentos de origen y hash de transacción cuando existe.

La joya probatoria: transacciones revertidas en la cadena, lanzadas deliberadamente. Por ejemplo, un `submitShipment` con una atestación que no firmó la naviera, o un intento de mover fondos de la Safe con la llave del agente hacia una dirección externa.

# Dónde se guarda

El PDR completo, en JSON con las reglas evaluadas y sus resultados, se guarda fuera de cadena en `evidence/pdr/<pdrHash>.json`, donde `pdrHash` es el digest EIP-712 de la decisión. En cadena va ese mismo hash, en el evento del gate (`PaymentExecuted`), así que desde una transacción se llega directo al archivo. El struct está en [PDR](../interfaces/pdr.md) y el script de evidencia es la tarea T5.5 del [Área 5](../trabajo/area-5-redteam-evidencia.md).
