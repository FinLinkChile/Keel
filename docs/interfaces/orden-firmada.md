---
type: Interfaz
title: "Orden firmada desde la app (Keel Trade)"
description: "Cómo entrega la app a ingesta una orden firmada por ambas partes: cuerpo, qué verifica ingesta antes de aceptarla, qué registra, qué archivo escribe para el agente y qué responde."
tags: [orden, eip-712, erc-1271, safe, ingesta, agente, t3-11, decision-17, paso-1]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T22:00:00Z }
---

**[PROPUESTA]** del Área 3 (T3.11), implementada en `ingest/src/trade/signedOrder.ts`. Responde a la [decisión 17](../decisiones/abiertas.md) del Área 2 (el relayer del agente envía `open` con las dos firmas) y al lado de la app del Área 4 (PR #85). Toca la decisión abierta 15, que deciden las Áreas 2, 3 y 4.

Sirve al [paso 1](../flujo/paso-1-firma-orden.md) y a los que siguen: sin esto, una orden creada en la app no la conocen ni la [carga de documentos](carga-de-documentos.md) ni el agente.

# Ruta

`POST /trade/orders`, con el `order.json` del agente en JSON canónico (llaves ordenadas, enteros grandes como texto decimal):

```json
{ "order": { "orderId": "0x…", "importer": "0x…", "…": "…" }, "terms": { "orderNumber": "PO0158", "…": "…" },
  "label": "PO-0158", "sigImporter": "0x…", "sigExporter": "0x…" }
```

Existe solo si ingesta conoce el escrow cuyo dominio firman las partes (`INGEST_ESCROW_ADDRESS`). No lleva token: la autenticación son las dos firmas.

# Qué verifica antes de aceptar

1. La forma: cada campo con su tipo, nada de más.
2. Que los términos sean los firmados: `termsHash(terms)` igual a `order.termsHash`.
3. Que el `orderId` sea el de las partes y el nonce, como lo calcula el contrato.
4. Que el importador esté registrado (los importadores del registro de órdenes y de `INGEST_IMPORTERS_FILE`, donde va la Safe).
5. La firma EIP-712 del exportador sobre la `PurchaseOrder`, en el dominio `Keel` del escrow.
6. La firma del importador. Si el importador es una Safe, la firma es de uno de sus dueños sobre el `SafeMessage` (ERC-1271). **Con `INGEST_RPC_URL`, la propia Safe dice si esa firma vale.** Sin RPC, la llave que firmó tiene que estar registrada como del importador: es una verificación más débil, pensada para una demo sin nodo, y se declara así.

# Qué hace si todo calza

* Guarda la orden en la base de ingesta (`signed_orders`): el archivo tal como se aceptó y quién puede subir documentos. Esta ruta es del servidor de ingesta: en AWS la API de órdenes recibe las dos firmas por `POST /proposals/{orderId}/importer-signature`, así que el registro de órdenes firmadas no forma parte de `IngestRepo` ni tiene versión en DynamoDB.
* La app guarda si ingesta registró la orden y, si no, la vuelve a enviar después de firmar y al abrirse; un rechazo le llega al importador como aviso con el motivo (`app/src/ingest/signedOrder.ts`).
* Registra como representantes al exportador y a la llave que firmó por el importador (el dueño de la Safe), porque una Safe no puede firmar una carga de documentos. Desde ese momento la carga de documentos acepta esa orden.
* Con `INGEST_AGENT_DIR`, escribe `orders/<orderId>/order.json` para el agente (`engine/src/agent/store.ts`).

La misma orden enviada otra vez responde que ya está registrada; otra orden con el mismo `orderId` se rechaza. No se paga ni se decide nada aquí: el agente vuelve a verificar las firmas al abrir el escrow, y el contrato también.

# Respuestas

| Código | Cuándo |
| --- | --- |
| 201 `registered` | Orden nueva aceptada |
| 200 `registered` (`already: true`) | La misma orden, otra vez |
| 400 `invalid_request` | El cuerpo no tiene la forma esperada |
| 401 `bad_exporter_signature`, `bad_importer_signature` | Una de las firmas no corresponde a la orden |
| 403 `unknown_importer` | El importador no está registrado |
| 409 `conflict` | Ya hay otra orden con ese `orderId` |
| 422 `terms_mismatch`, `bad_order_id` | Los términos o el id no son los de la orden firmada |
