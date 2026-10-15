---
type: Arquitectura
title: "Servicio del agente"
description: "Qué hace el servicio del agente en cada vuelta, de dónde lee sus datos, qué avisos emite para el bot y dónde se conecta el gate de Trade."
tags: [agente, relayer, t2-11, servicio, avisos, datos]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T17:30:00Z }
---

El servicio del agente (T2.11, `engine/src/agent/`) une la ingesta, el motor, el PDR y el relayer para la Safe de un importador. Se ejecuta con `npm run keel -- agent --data <carpeta>`.

# Qué hace en cada vuelta

Lee de TradeEscrow el estado de cada orden guardada cuyo importador es su Safe y da como máximo un paso por orden:

| Estado | Paso |
| --- | --- |
| OPEN | Evalúa el depósito, firma el PDR y lo envía por el gate de Trade ([paso 2](../flujo/paso-2-deposito.md)). Proveedor nuevo: `cambio_en_cola`. Nivel 3: `en_aprobacion`, con el PDR listo para la cofirma. Nivel 4: `bloqueada` |
| ADVANCE_PAID | Presenta la atestación de la naviera con `submitShipment` ([paso 4](../flujo/paso-4-embarque.md)). Si no hay atestación y pasó la fecha límite más `refundGrace` (leído del escrow), llama a `refundAfterDeadline` ([paso 6](../flujo/paso-6-reembolso.md)). Antes avisa que el plazo se acerca |
| SHIPPED | Pasada la ventana de disputa, compara los documentos contra la orden y la atestación, firma el `DocumentDecision`, guarda la evidencia y llama a `releaseBalance` ([paso 5](../flujo/paso-5-saldo.md)). Si no son conformes, retiene y avisa: el importador puede liberar a mano o abrir una disputa |
| Disputa y estados finales | Nada: en una disputa mueven los fondos el árbitro o ambas partes |

Toda llamada se simula antes de enviarse (T2.5): si revertiría, la operación queda retenida con el nombre del error y no se gasta gas. El servicio no guarda estado propio aparte de los avisos ya enviados: la fuente de verdad es la cadena, así que repetir una vuelta no envía nada dos veces.

Para quién vale: el relayer no gana autoridad. Sin un PDR o una firma válida, el gate y el escrow revierten, y la llave de política firma solo PDR (`engine/src/keys.ts`). Pruebas: `engine/src/agent/agent.test.ts`, contra el TradeEscrow real compilado.

# De dónde lee los datos

Mientras la [decisión abierta 15](../decisiones/abiertas.md) siga abierta, son archivos JSON en la carpeta `--data`, con los montos como texto decimal:

| Archivo | Contenido | Lo escribe |
| --- | --- | --- |
| `registry.json` | `parties` (dirección y, para el importador, `taxId`), `knownSuppliers` (exportador y cuenta de cobro verificados), `history` (montos anteriores por exportador) | Onboarding (Área 4) |
| `orders/<orderId>/order.json` | `order` (la `PurchaseOrder`) y `terms` (los `OrderTerms`) | App (Área 4) |
| `orders/<orderId>/shipment.json` | `attestation` y `sigCarrier` | Naviera (en la demo, un script) |
| `orders/<orderId>/documents.json` | `extractions` (`transport` e `invoice`) y `fileHashes` | Ingesta (Área 3) |

La orden que vale es la que guarda el escrow; del archivo solo se usan los términos, y el motor comprueba que su hash sea el `termsHash` firmado.

# Avisos para el bot

Cada paso enviado, cada retención y cada aviso se emite una vez como una línea JSON (`AgentEvent`): `orderId`, `state`, `outcome` (`sent`, `held`, `notice`, `failed`), `reason` (un código, nunca texto libre), y según el caso `action`, `hold` (estado fuera de cadena de T2.6), `txHash`, `pdrHash`, `revert` y las reglas que retuvieron. El bot (Área 4) convierte cada código en una plantilla (D8).

# El gate de Trade

El gate del Área 1 todavía no existe. Mientras tanto, una orden en OPEN espera con `GATE_NOT_DEPLOYED`. Cuando exista, se conecta por `FundingGatePort`: su dirección, el cupo y el nonce que lee, el calldata exacto que ejecuta la Safe (`approve` exacto y `fund`, decisión 7) y la llamada al gate con el PDR firmado.
