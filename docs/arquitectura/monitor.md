---
type: Arquitectura
title: "Monitor de uso fuera del sistema"
description: "Qué vigila el monitor (T2.8), cuándo pausa el gate de Trade y con qué llave, qué solo avisa y qué avisos envía al bot."
tags: [monitor, t2-8, panico, pausa, llaves, acto-4]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T19:00:00Z }
---

El monitor (T2.8, `engine/src/monitor/`) vigila el FundingGate y el TradeEscrow de la Safe de un importador y reacciona cuando llega a la cadena algo que el motor no decidió. Es el cierre del acto 4 (llave robada). Se ejecuta con `npm run keel -- monitor --data <carpeta>`, con `KEEL_RPC_URL`, `KEEL_ESCROW`, `KEEL_SAFE` y `KEEL_FUNDING_GATE`, y opcionalmente `MONITOR_PAUSER_PRIVATE_KEY`, `KEEL_BOT_URL` y `KEEL_BOT_TOKEN`.

# Cuándo actúa

| Lo que ve | Cómo lo sabe | Qué hace |
| --- | --- | --- |
| `FundingExecuted` del gate con un PDR que no está en `evidence/pdr/` | El motor guarda cada PDR que emite (T2.4) | **Incidente:** la llave de política firmó fuera del motor. Pausa el gate y avisa |
| `BalanceReleased` del escrow autorizado por un digest que no es un PDR del motor ni la `BalanceApproval` del importador | Recalcula el digest de la aprobación del importador con la atestación que guarda el escrow | **Incidente:** la llave del verificador firmó fuera del motor (en el prototipo es la misma llave de política). Pausa el gate y avisa. El saldo ya salió, pero solo a la cuenta firmada en la orden |
| `ChangeQueued` (proveedor o tercero en cola) | Evento del gate | Avisa, sin actuar: la Safe o el cosignatario pueden vetarlo durante la espera |
| `ChangeVetoed`, `GatePaused`, `GateUnpaused`, `PolicySignerSet`, `PolicyHashSet`, `CosignerSet`, `GuardianSet` | Eventos del gate | Lo registra. Avisa al bot solo de las pausas |

Pausa una sola vez por incidente: después solo avisa. Lee cada bloque una vez, por tramos (2.000 bloques por defecto), y nunca envía otra cosa que la pausa.

# Con qué llave pausa

**Decisión del Área 2 (16 de octubre):** con una llave que solo puede pausar (`MONITOR_PAUSER_PRIVATE_KEY`), que el gate registra como su `guardian` (agregado por el Área 1 en el PR #67, pedido en la revisión del #57). La Safe la fija con `setGuardian`, y el gate exige que sea distinta del firmante de política, del cosignatario y de la Safe. Nunca con la del cosignatario, porque esa también cofirma el nivel 3 y juntaría en el servidor la llave de política y la de cofirma ([custodia de llaves](custodia-de-llaves.md)).

`emergencyPause` lo aceptan la Safe, el cosignatario y el guardian. El monitor simula la pausa antes de enviarla: si revierte (`OnlyPauser`, por ejemplo porque la llave no es o ya no es el guardian), no gasta gas y el incidente queda como **aviso** al cosignatario humano, que pausa desde la app. Ese es el respaldo, y coincide con el [recorte](../trabajo/recortes.md) ya aceptado. Sin llave de pausa, el monitor también solo avisa.

Para quién vale: el monitor no puede mover fondos ni aprobar nada; quien robe su llave solo puede pausar el gate, y reanudar es solo de la Safe. Limita el daño de una llave de política robada, no lo evita: la primera operación ya ocurrió cuando la detecta. Pruebas: `engine/src/monitor/monitor.test.ts`, contra FundingGate y TradeEscrow compilados. Un depósito firmado fuera del motor pausa el gate y el siguiente revierte con `GateIsPaused`; la pausa se prueba con la llave del guardian, y una llave sin ese rol solo avisa.

# Avisos al bot

Cada evento sale como una línea JSON. Con el bot configurado, además se envían avisos de billetera a `POST /notices`, uno por solicitud:

| Evento | Aviso |
| --- | --- |
| Proveedor en cola | `change_queued` con `supplier_added` y la fecha en que cuenta |
| Tercero en cola | `change_queued` con `role_change` |
| Pausa (del monitor o de otro) | `gate_paused`, un solo aviso por transacción de pausa |
| Incidente | `unauthorized_execution` con el hash de la transacción |

El aviso `unauthorized_execution` (cuenta del importador y `txHash`) lo propuso el Área 2 y lo adoptó el Área 4 en el PR #76: el bot lo acepta y lo envía al dueño, al operador y al cosignatario del importador. Los avisos se comprueban contra el esquema `Notice` del bot (`engine/src/monitor/notices.test.ts`).

# Límites

* **Evidencia local:** el monitor lee la misma carpeta `evidence/pdr/` que escribe el motor. Si corren en máquinas distintas, esa carpeta tiene que estar sincronizada, o el monitor verá incidentes falsos.
* **Desde dónde lee:** sin `--from-block`, empieza en el bloque siguiente al último. Lo anterior no se revisa.
* **Revocar al agente** (rol COSIGNATARIO en Roles, T1.3) no está construido: en Trade, pausar el gate cumple el mismo fin.
