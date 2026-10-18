---
type: Arquitectura
title: "Servicio del agente"
description: "Qué hace el servicio del agente en cada vuelta, de dónde lee sus datos, qué avisos emite para el bot, dónde se conecta el gate de Trade y qué riesgo de llaves declara el prototipo."
tags: [agente, relayer, t2-11, t2-6, servicio, avisos, datos, bot]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-16T18:00:00Z }
---

El servicio del agente (T2.11, `engine/src/agent/`) une la ingesta, el motor, el PDR y el relayer para la Safe de un importador. Se ejecuta con `npm run keel -- agent --data <carpeta>` y `KEEL_RPC_URL`. El escrow, la Safe, el gate y las llaves de cupo salen de `contracts/deployments/<chainId>.json` (Área 1, T1.8; otra carpeta con `--deployments`), y las búsquedas de logs del escrow parten del `deployBlock` de ese archivo, porque muchos proveedores de RPC limitan el rango de `getLogs`. Donde el archivo no los tiene, como en una cadena local, se dan con `KEEL_ESCROW`, `KEEL_SAFE`, `KEEL_FUNDING_GATE` (para depositar) y las llaves de cupo `KEEL_AGENT_ALLOWANCE_KEY` y `KEEL_COSIGNED_ALLOWANCE_KEY`; una variable que contradice el archivo detiene el agente. Con el Zodiac Roles real y las llaves de cupo, el agente lee el cupo restante con `allowances(key)`, sumando las recargas acumuladas como Roles 2.1.1, y calcula el `rolesConfigHash` desde la cadena (si además se da `KEEL_ROLES_CONFIG_HASH`, tiene que coincidir). En la demo sobre `MockTradeRoles`, o sin gate, el `rolesConfigHash` viene de `KEEL_ROLES_CONFIG_HASH`.

# Qué hace en cada vuelta

Lee de TradeEscrow el estado de cada orden guardada cuyo importador es su Safe y da como máximo un paso por orden:

| Estado | Paso |
| --- | --- |
| OPEN | Evalúa el depósito, firma el PDR y lo envía por el FundingGate ([paso 2](../flujo/paso-2-deposito.md)). Proveedor nuevo o todavía en su plazo: `cambio_en_cola`. Nivel 3: `en_aprobacion`, con el PDR listo para la cofirma. Nivel 4 (por ejemplo, una naviera que la Safe no aprobó): `bloqueada` |
| ADVANCE_PAID | Si ya pasó la fecha límite más `refundGrace` (leído del escrow, con la misma comparación `now > shipmentDeadline + refundGrace`), llama a `refundAfterDeadline` ([paso 6](../flujo/paso-6-reembolso.md)), haya o no atestación. Si no, presenta la atestación de la naviera con `submitShipment` ([paso 4](../flujo/paso-4-embarque.md)), con dos controles antes de simular (abajo). Sin atestación, recuerda la fecha límite a 5, 3 y 1 día, una vez cada uno: si una vuelta llega tarde, salta al recordatorio más cercano y no repite los anteriores |
| SHIPPED | Pasada la ventana de disputa, compara los documentos contra la orden y la atestación, firma el `DocumentDecision`, guarda la evidencia y llama a `releaseBalance` ([paso 5](../flujo/paso-5-saldo.md)). Si no son conformes, retiene y avisa: el importador puede liberar a mano o abrir una disputa |
| Disputa y estados finales | Nada: en una disputa mueven los fondos el árbitro o ambas partes |

Toda llamada se simula antes de enviarse (T2.5): si revertiría, la operación queda retenida con el nombre del error y no se gasta gas. El nombre sale de los errores de TradeEscrow, del FundingGate (con los heredados de `PDRVerifier` y OpenZeppelin), de Roles (`NoMembership`, `ConditionViolation`, `ModuleTransactionFailed`) y del token; un error desconocido queda como hex (`engine/src/agent/errors.ts`). Dos pruebas exigen que los errores del escrow y del gate que decodifica el agente sean exactamente `ESCROW_ERRORS` y `GATE_ERRORS` de `schemas`, con las mismas firmas que el contrato compilado. El servicio no guarda estado propio aparte de los avisos ya enviados: la fuente de verdad es la cadena, así que repetir una vuelta no envía nada dos veces.

Para quién vale: el relayer no gana autoridad. Sin un PDR o una firma válida, el gate y el escrow revierten, y la llave de política firma solo PDR (`engine/src/keys.ts`). Pruebas: `engine/src/agent/agent.test.ts`, contra TradeEscrow y FundingGate compilados, con el mock de Roles de Trade: una orden va del depósito al saldo sin pasos manuales y el PDR del depósito verifica con `keel verify`.

# Antes de presentar el embarque

Dos controles evitan enviar un `submitShipment` que revertiría por una causa que el agente ya puede ver:

* **Margen antes del reembolso (`SHIPMENT_CUTOFF`).** Desde el primer segundo del reembolso, `submitShipment` revierte con `DeadlinePassed`. Una atestación simulada justo antes podría minarse después y revertir. Si `now + margen > shipmentDeadline + refundGrace`, el agente no la envía: retiene (`bloqueada`) y, cuando el reembolso vence, la vuelta siguiente llama a `refundAfterDeadline`. El margen es `shipmentMarginSeconds` de `AgentConfig`, 120 segundos por defecto, pensado para la espera de inclusión en la red cerrada. Con el `refundGrace` de la demo (60 segundos) el corte cae 60 segundos antes de la fecha límite; con el de producción (1 día), casi un día después de ella. El aviso de que falta la atestación sigue siendo el recordatorio de la fecha límite, que a 1 día ya se envió, antes del corte.
* **Fecha *on board* anterior al depósito (`ON_BOARD_BEFORE_FUNDING`).** El escrow rechaza una `onBoardDate` anterior al momento del depósito con `InvalidAttestation`, que tiene otras dos causas. Ese momento es privado en el escrow: el agente lo toma del bloque del evento `OrderFunded` de la orden (`AgentChain.fundedAt`, por `eth_getLogs` más la hora del bloque, desde el `fromBlock` de `rpcChain` o desde el inicio de la cadena). Si la fecha es anterior, retiene (`bloqueada`) con ese motivo, para que la naviera vuelva a firmar con un instante igual o posterior al depósito. Si no encuentra el evento, decide la simulación.

Pruebas: `engine/src/agent/agent.test.ts`, contra el TradeEscrow compilado: dentro del margen no se envía nada y al vencer se reembolsa (el escrow confirma `DeadlinePassed`); el margen es inclusivo y configurable; una fecha anterior al depósito se retiene, sin el control la simulación revierte con `InvalidAttestation` y la atestación firmada de nuevo se acepta. `engine/src/agent/rpc.test.ts` prueba `fundedAt` contra un nodo JSON-RPC.

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
| `SIMULATION_REVERTED`, `SHIPMENT_CUTOFF` | `operation_held`, `simulation_failed` |
| `ATTESTATION_UNKNOWN`, `IMPORTER_NOT_REGISTERED`, `ON_BOARD_BEFORE_FUNDING` | `operation_held`, `agent_data_incomplete` |
| Esperas, `AGENT_ERROR`, envíos revertidos | Nada: quedan solo en la línea JSON |

Reglas del adaptador:

* **Sin direcciones ni texto libre:** las partes van como cuentas del directorio del bot (`account` en `registry.json`) y la orden con su `label`. Sin etiqueta válida o sin cuenta del importador o del exportador no se envía el aviso, y queda una línea `bot: skipped` con el motivo. El árbitro se omite si no tiene cuenta propia.
* **Montos:** en la unidad menor de la moneda de los términos firmados, repartidos como reparte el escrow: anticipo `total * advanceBps / 10000`, saldo y reembolso el resto.
* **Fecha límite (D8):** toda retención antes del embarque lleva la fecha límite de embarque. Después del embarque el escrow no tiene plazo para el importador, que puede liberar a mano o abrir una disputa.
* **Ids fijos:** `<orderId>:<paso>`, `<orderId>:held:<estado>:<motivo>` y `<orderId>:deadline:<días>`. El bot envía cada id una vez, así que un escucha futuro de los eventos del escrow puede usar los mismos ids sin duplicar mensajes.
* **Nunca en el camino del pago:** timeout de 3 segundos; si el bot está caído o rechaza el lote, solo queda una línea `bot: unreachable` o `bot: rejected` (sin el token ni el cuerpo) y el agente sigue.

`funding_blocked`, `simulation_failed` y `agent_data_incomplete` los pidió el Área 2 y el Área 4 los agregó al bot en el PR #50: llegan solo al dueño y al operador del importador. `SHIPMENT_CUTOFF` y `ON_BOARD_BEFORE_FUNDING` usan esos mismos motivos, sin cambiar el bot; un texto propio para pedir a la naviera que vuelva a firmar sería un motivo nuevo del bot (Área 4). Los avisos se comprobaron contra el esquema `Notice` del bot ([avisos al bot](../interfaces/avisos-al-bot.md)).

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

# Riesgo del prototipo: una llave para depósitos y documentos

El mismo servicio firma el PDR del depósito y el `DocumentDecision` del saldo: en el prototipo, el verificador de documentos de cada orden es la llave de política del motor ([custodia de llaves](custodia-de-llaves.md)). Por ahora no se separan.

* **A quién afecta:** a los importadores cuyas órdenes nombran como `documentVerifier` a la llave de Keel. Quien robe esa llave, o tome el servidor del agente, puede firmar depósitos y dar por conformes documentos que no lo son.
* **Dónde se limita el depósito:** en la cadena, en el FundingGate: solo órdenes abiertas de esa Safe, con un proveedor conocido (par exportador y cuenta de cobro) y terceros de confianza de sus registros, y dentro del cupo del rol AGENTE en Roles. Sobre el cupo, el nivel 3 exige además la firma del cosignatario.
* **Dónde se limita el saldo:** en el escrow, que exige además la atestación firmada por la naviera (otra llave) y la ventana de disputa, y paga solo a la `payoutAddress` que ambas partes firmaron en la orden. La llave no puede cambiar a quién se paga.
* **Camino a producción:** un verificador de documentos con llave y proceso propios, distinto del firmante de política, nombrado en cada orden.

# En AWS **[PROPUESTA]**

En la rama `AWS` el mismo `Agent` corre en una Lambda por Safe ([despliegue en AWS](despliegue-aws.md)), con tres cambios de comportamiento que también valen para `keel agent`:

* **Abre las órdenes.** Una orden guardada con las dos firmas y en estado `NONE` en el escrow se abre con `open(po, sigImporter, sigExporter)`, simulando antes. Sin las dos firmas se ignora, como antes ([decisión abierta 15](../decisiones/abiertas.md)).
* **Envía las firmas de cierre que recibe la API**, antes de su propio paso: en Embarcado, la aprobación del saldo del importador (solo si su `attestationHash` es el que aceptó el escrow); en Abierto, Anticipo pagado o En disputa, la cancelación firmada por ambas partes si su `cancelNonce` es el actual; en disputa, la resolución del árbitro. Mientras solo el importador firmó la cancelación de una orden Abierta, no la deposita (`CANCEL_PENDING`, sin aviso).
* **La evidencia se guarda antes de enviar** por un gancho (`AgentDeps.saveEvidence`): en AWS va a S3 con Object Lock; si falla, la orden queda en `AGENT_ERROR` y no se envía nada.

Los datos salen de DynamoDB en lugar de la carpeta `--data` (`aws/src/agent/store.ts`), con el mismo JSON. Pruebas: `engine/src/agent/agent.test.ts` y `aws/src/handlers/*.test.ts`.
