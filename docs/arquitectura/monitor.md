---
type: Arquitectura
title: "Monitor de uso fuera del sistema"
description: "Qué vigila el monitor (T2.8), cuándo pausa el gate de Trade y con qué llave, qué solo avisa y qué avisos envía al bot."
tags: [monitor, t2-8, panico, pausa, llaves, acto-4]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-16T04:00:00Z }
---

El monitor (T2.8, `engine/src/monitor/`) vigila el FundingGate y el TradeEscrow de la Safe de un importador y reacciona cuando llega a la cadena algo que el motor no decidió. Es el cierre del acto 4 (llave robada). Se ejecuta con `npm run keel -- monitor --data <carpeta>`, con `KEEL_RPC_URL`, `KEEL_ESCROW`, `KEEL_SAFE` y `KEEL_FUNDING_GATE`, y opcionalmente `MONITOR_PAUSER_PRIVATE_KEY`, `KEEL_BOT_URL` y `KEEL_BOT_TOKEN`.

# Cuándo actúa

| Lo que ve | Cómo lo sabe | Qué hace |
| --- | --- | --- |
| `FundingExecuted` del gate con un PDR que no está en `evidence/pdr/` | El motor guarda cada PDR que emite (T2.4) | **Incidente:** la llave de política firmó fuera del motor. Pausa el gate y avisa |
| `BalanceReleased` del escrow autorizado por un digest que no es un PDR del motor ni la `BalanceApproval` del importador | Recalcula el digest de la aprobación del importador con la atestación que guarda el escrow | **Incidente:** la llave del verificador firmó fuera del motor (en el prototipo es la misma llave de política). Pausa el gate y avisa. El saldo ya salió, pero solo a la cuenta firmada en la orden |
| `ChangeQueued` (proveedor o tercero en cola) | Evento del gate | Avisa, sin actuar: la Safe o el cosignatario pueden vetarlo durante la espera |
| `ChangeVetoed`, `GatePaused`, `GateUnpaused`, `PolicySignerSet`, `PolicyHashSet`, `CosignerSet` | Eventos del gate | Lo registra. Avisa al bot solo de las pausas |

Pausa una sola vez por incidente: después solo avisa. Lee cada bloque una vez, por tramos (2.000 bloques por defecto), y nunca envía otra cosa que la pausa.

# Con qué llave pausa

**Decisión del Área 2 (16 de octubre):** con una llave que solo puede pausar (`MONITOR_PAUSER_PRIVATE_KEY`), por un rol propio del gate que se pidió al Área 1 en la revisión del PR #57. Nunca con la del cosignatario, porque esa también cofirma el nivel 3 y juntaría en el servidor la llave de política y la de cofirma ([custodia de llaves](custodia-de-llaves.md)).

Mientras ese rol no exista, `emergencyPause` solo lo aceptan la Safe y el cosignatario. El monitor simula la pausa antes de enviarla: si revierte (`OnlySafeOrCosigner`), no gasta gas y el incidente queda como **aviso** al cosignatario humano, que pausa desde la app. Ese es el respaldo, y coincide con el [recorte](../trabajo/recortes.md) ya aceptado. Sin llave de pausa, el monitor también solo avisa.

Para quién vale: el monitor no puede mover fondos ni aprobar nada; quien robe su llave solo puede pausar el gate, y reanudar es solo de la Safe. Limita el daño de una llave de política robada, no lo evita: la primera operación ya ocurrió cuando la detecta. Pruebas: `engine/src/monitor/monitor.test.ts`, contra FundingGate y TradeEscrow compilados. Un depósito firmado fuera del motor pausa el gate y el siguiente revierte con `GateIsPaused`; la pausa se prueba con la llave del cosignatario como sustituto del rol que agregará el Área 1.

# Avisos al bot

Cada evento sale como una línea JSON. Con el bot configurado, además se envían avisos de billetera a `POST /notices`, uno por solicitud:

| Evento | Aviso |
| --- | --- |
| Proveedor en cola | `change_queued` con `supplier_added` y la fecha en que cuenta |
| Tercero en cola | `change_queued` con `role_change` |
| Pausa (del monitor o de otro) | `gate_paused`, un solo aviso por transacción de pausa |
| Incidente | `unauthorized_execution` con el hash de la transacción **[PROPUESTA]** |

**[PROPUESTA] al Área 4:** el bot no tiene un aviso para una ejecución que el motor no decidió. Se propone `unauthorized_execution` (cuenta del importador y `txHash`). Hasta que exista, el bot lo rechaza y el incidente queda en el registro del monitor y, si hubo pausa, en el aviso `gate_paused`. Los avisos se comprueban contra el esquema `Notice` del bot (`engine/src/monitor/notices.test.ts`).

# Límites

* **Evidencia local:** el monitor lee la misma carpeta `evidence/pdr/` que escribe el motor. Si corren en máquinas distintas, esa carpeta tiene que estar sincronizada, o el monitor verá incidentes falsos.
* **Desde dónde lee:** sin `--from-block`, empieza en el bloque siguiente al último. Lo anterior no se revisa.
* **Revocar al agente** (rol COSIGNATARIO en Roles, T1.3) no está construido: en Trade, pausar el gate cumple el mismo fin.
