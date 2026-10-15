---
type: Arquitectura
title: "Servicio del agente"
description: "Qué hace el servicio del agente en cada vuelta, de dónde lee sus datos, qué avisos emite para el bot y dónde se conecta el gate de Trade."
tags: [agente, relayer, t2-11, t2-6, servicio, avisos, datos, bot]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T23:50:00Z }
---

El servicio del agente (T2.11, `engine/src/agent/`) une la ingesta, el motor, el PDR y el relayer para la Safe de un importador. Se ejecuta con `npm run keel -- agent --data <carpeta>`, con `KEEL_RPC_URL`, `KEEL_ESCROW`, `KEEL_SAFE`, `KEEL_ROLES_CONFIG_HASH` y, para depositar, `KEEL_FUNDING_GATE`.

# Qué hace en cada vuelta

Lee de TradeEscrow el estado de cada orden guardada cuyo importador es su Safe y da como máximo un paso por orden:

| Estado | Paso |
| --- | --- |
| OPEN | Evalúa el depósito, firma el PDR y lo envía por el FundingGate ([paso 2](../flujo/paso-2-deposito.md)). Proveedor nuevo o todavía en su plazo: `cambio_en_cola`. Nivel 3: `en_aprobacion`, con el PDR listo para la cofirma. Nivel 4 (por ejemplo, una naviera que la Safe no aprobó): `bloqueada` |
| ADVANCE_PAID | Presenta la atestación de la naviera con `submitShipment` ([paso 4](../flujo/paso-4-embarque.md)). Si no hay atestación y pasó la fecha límite más `refundGrace` (leído del escrow), llama a `refundAfterDeadline` ([paso 6](../flujo/paso-6-reembolso.md)). Antes recuerda la fecha límite a 5, 3 y 1 día, una vez cada uno: si una vuelta llega tarde, salta al recordatorio más cercano y no repite los anteriores |
| SHIPPED | Pasada la ventana de disputa, compara los documentos contra la orden y la atestación, firma el `DocumentDecision`, guarda la evidencia y llama a `releaseBalance` ([paso 5](../flujo/paso-5-saldo.md)). Si no son conformes, retiene y avisa: el importador puede liberar a mano o abrir una disputa |
| Disputa y estados finales | Nada: en una disputa mueven los fondos el árbitro o ambas partes |

Toda llamada se simula antes de enviarse (T2.5): si revertiría, la operación queda retenida con el nombre del error y no se gasta gas. El servicio no guarda estado propio aparte de los avisos ya enviados: la fuente de verdad es la cadena, así que repetir una vuelta no envía nada dos veces.

Para quién vale: el relayer no gana autoridad. Sin un PDR o una firma válida, el gate y el escrow revierten, y la llave de política firma solo PDR (`engine/src/keys.ts`). Pruebas: `engine/src/agent/agent.test.ts`, contra TradeEscrow y FundingGate compilados, con el mock de Roles de Trade: una orden va del depósito al saldo sin pasos manuales y el PDR del depósito verifica con `keel verify`.

# De dónde lee los datos

Mientras la [decisión abierta 15](../decisiones/abiertas.md) siga abierta, son archivos JSON en la carpeta `--data`, con los montos como texto decimal:

| Archivo | Contenido | Lo escribe |
| --- | --- | --- |
| `registry.json` | `parties` (dirección, `account` en el directorio del bot y, para el importador, `taxId`) y `history` (montos anteriores por exportador) | Onboarding (Área 4) |
| `orders/<orderId>/order.json` | `order` (la `PurchaseOrder`), `terms` (los `OrderTerms`) y `label` (la etiqueta de los avisos, como `PO-0131`) | App (Área 4) |
| `orders/<orderId>/shipment.json` | `attestation` y `sigCarrier` | Naviera (en la demo, un script) |
| `orders/<orderId>/documents.json` | `extractions` (`transport` e `invoice`) y `fileHashes` | Ingesta (Área 3) |

La orden que vale es la que guarda el escrow; del archivo solo se usan los términos, y el motor comprueba que su hash sea el `termsHash` firmado. Los proveedores conocidos y los terceros de confianza no vienen de un archivo: se leen del FundingGate (abajo).

# Avisos para el bot (T2.6)

Cada paso enviado, cada retención y cada recordatorio se emite una vez como una línea JSON (`AgentEvent`): `orderId`, `state`, `outcome` (`sent`, `held`, `notice`, `failed`), `reason` (un código, nunca texto libre), y según el caso `action`, `hold` (estado fuera de cadena), `txHash`, `pdrHash`, `revert`, las reglas que retuvieron y, en los recordatorios, `daysLeft` y `reminder`.

Si están `KEEL_BOT_URL` y `KEEL_BOT_TOKEN` (el mismo valor que `BOT_INBOUND_TOKEN` del bot), un adaptador del motor (`engine/src/agent/notices.ts`) traduce cada evento a los `Notice` del bot y los envía a `POST /notices` ([interfaz del Área 4](../interfaces/avisos-al-bot.md)). La traducción vive en el motor porque los códigos son suyos; el bot vuelve a validar todo con su esquema estricto.

| Evento del agente | Aviso del bot |
| --- | --- |
| `fund` enviado | `order_funded` y, si hay anticipo, `advance_released` |
| `submitShipment` enviado | `shipment_accepted`, con la fecha *on board* de la atestación |
| `releaseBalance` enviado | `balance_released` |
| `refundAfterDeadline` enviado | `refunded` |
| `DEADLINE_SOON` | `deadline_approaching`, con la fecha límite y los días que faltan |
| `SUPPLIER_NEW` | `operation_held`, `new_supplier_wait` |
| `COSIGNATURE_NEEDED` | `operation_held`, `over_limit_cosign` |
| `DOCUMENTS_DO_NOT_CONFORM` | `operation_held`: `hidden_text`, `account_change_mention` o `documents_mismatch`, el más específico |
| `FUNDING_BLOCKED` | `operation_held`, `funding_blocked` |
| `SIMULATION_REVERTED` | `operation_held`, `simulation_failed` |
| `ATTESTATION_UNKNOWN`, `IMPORTER_NOT_REGISTERED` | `operation_held`, `agent_data_incomplete` |
| Esperas, `AGENT_ERROR`, envíos revertidos | Nada: quedan solo en la línea JSON |

Reglas del adaptador:

* **Sin direcciones ni texto libre:** las partes van como cuentas del directorio del bot (`account` en `registry.json`) y la orden con su `label`. Sin etiqueta válida o sin cuenta del importador o del exportador no se envía el aviso, y queda una línea `bot: skipped` con el motivo. El árbitro se omite si no tiene cuenta propia.
* **Montos:** en la unidad menor de la moneda de los términos firmados, repartidos como reparte el escrow: anticipo `total * advanceBps / 10000`, saldo y reembolso el resto.
* **Fecha límite (D8):** toda retención antes del embarque lleva la fecha límite de embarque. Después del embarque el escrow no tiene plazo para el importador, que puede liberar a mano o abrir una disputa.
* **Ids fijos:** `<orderId>:<paso>`, `<orderId>:held:<estado>:<motivo>` y `<orderId>:deadline:<días>`. El bot envía cada id una vez, así que un escucha futuro de los eventos del escrow puede usar los mismos ids sin duplicar mensajes.
* **Nunca en el camino del pago:** timeout de 3 segundos; si el bot está caído o rechaza el lote, solo queda una línea `bot: unreachable` o `bot: rejected` (sin el token ni el cuerpo) y el agente sigue.

`funding_blocked`, `simulation_failed` y `agent_data_incomplete` los pidió el Área 2 y el Área 4 los agregó al bot en el PR #50: llegan solo al dueño y al operador del importador. Los avisos se comprobaron contra el esquema `Notice` del bot ([avisos al bot](../interfaces/avisos-al-bot.md)).

# El gate de Trade

El agente usa el FundingGate del Área 1 por `FundingGatePort` (`engine/src/agent/gate.ts`). Sin `KEEL_FUNDING_GATE`, una orden en OPEN espera con `GATE_NOT_DEPLOYED`.

| Qué | Cómo |
| --- | --- |
| Registros | Antes de decidir, lee del gate `isKnownSupplier(exportador, cuenta de cobro)` y `hasRole` de la naviera, el árbitro y el verificador. Con eso arma las partes registradas y el proveedor conocido del motor, sin cambiar sus reglas (`keel-trade/2`). Así el motor nunca aprueba lo que el gate rechazaría: un par sin aprobar o en su plazo es proveedor nuevo (nivel 2) y un tercero sin rol bloquea (nivel 4) |
| Cupo | El restante del rol AGENTE en Roles. Si la orden no cabe, el motor la sube a nivel 3 |
| Calldata | `abi.encode(approveData, fundData)`, el mismo que hashea el gate; una prueba lo compara con `fundingCalldataOf` |
| Nonce | `uint256(orderHash)`: uno por versión de la orden. El gate lo marca usado, así que un reintento tras una caída no puede depositar dos veces |
| Envío | `execute(intent, decisión, firma de política, firma del cosignatario)`, con la firma del cosignatario vacía en nivel 1 |

Lo que falta:

* **Nivel 3:** el agente deja el PDR firmado en la evidencia y se detiene en `en_aprobacion`. Cómo vuelve la firma del cosignatario para enviar `execute` es la [decisión abierta 16](../decisiones/abiertas.md).
* **Cupo con la Roles real:** hoy se lee de `MockTradeRoles` (`remaining`). El lector de Zodiac Roles va con el despliegue y las pruebas contra el fork (T1.7).
