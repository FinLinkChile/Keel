---
type: Interfaz
title: "Avisos al bot de Telegram"
description: "Cómo le entregan el motor, la ingesta y otros productores los avisos al bot: dos rutas HTTP, sus tokens, cuerpos y respuestas, y cómo se traduce la salida de ingesta a avisos."
tags: [bot, avisos, telegram, ingesta, motor, t4-3, t4-6]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T22:00:00Z }
---

**[PROPUESTA]** Diseño del Área 4 (T4.3 y T4.6) para que lo usen las Áreas 2 y 3. El código ya existe en `bot/` **[HECHO]**. Está por confirmar con las Áreas 2 y 3.

El dueño es el Área 4. La interfaz vive en `bot/`, no en `schemas/`, y no está bajo el congelamiento de las [reglas de cambio](reglas-de-cambio.md). El detalle (variables, plantillas, ruteo y ejemplos) está en [bot/README.md](../../bot/README.md).

# Qué hace el bot con lo que recibe

El bot solo consume. No decide, no autoriza y no ejecuta: no firma, no consulta saldos y no mueve fondos. Ninguna área recibe nada del bot. Con cada aviso arma un mensaje con plantillas fijas y campos tipados, y lo envía a los chats registrados de quien corresponda.

Todo lo que llega se valida contra el esquema estricto del bot (`Notice`). Lo que no valida no se envía: queda registrado y contado.

# Las dos rutas

Las dos rutas comparten un servidor que por defecto escucha solo en `127.0.0.1` (`BOT_HOST`, `BOT_PORT`, por defecto `8789`). Cada una tiene su propio token Bearer, que se compara en tiempo constante. Una ruta sin su token configurado no existe y responde `404`. El cuerpo máximo es de 64 KB (si se pasa, `413`).

| Ruta | Para quién | Token | Cuerpo |
| --- | --- | --- | --- |
| `POST /notices` | Motor y otros productores | `BOT_INBOUND_TOKEN` | Un `Notice` del bot o un arreglo de hasta 100 |
| `POST /ingest/outcomes` | Ingesta | `BOT_INGEST_TOKEN` | La salida de ingesta tal cual (abajo) |

Los dos tokens miden al menos 32 caracteres, son distintos entre sí y distintos de `INGEST_WEBHOOK_TOKEN`.

**Respuestas de `POST /notices`:** `401` sin token válido; `400` si algún aviso no valida, y entonces no se envía ninguno del lote; `202` con el estado de cada aviso (`accepted`, `duplicate` o `rejected`).

**Respuestas de `POST /ingest/outcomes`:** `401` sin token válido. `400` con `invalid_body` si el cuerpo no tiene la forma mínima, con `mapper_failed` si la salida no se pudo traducir (el registro guarda solo la clase del error, nunca valores), o con `source_disabled` si esa fuente no está configurada. `202` con `accepted`, `duplicate`, `rejected` (el aviso traducido no validó) o `ignored` (no hay nada que avisar).

# Llamada opcional y sin bloquear

Avisar es opcional y nunca es un paso del camino de pago. Un productor llama al bot solo si tiene configurados la URL y el token del bot. Si el bot está caído o tarda, el correo, el documento o la decisión se procesan igual: timeout corto y el error solo se registra.

Mandar dos veces lo mismo no repite el mensaje: cada aviso tiene un `id` y el bot envía cada `id` una sola vez. La deduplicación vive en memoria, así que un reinicio del bot puede reenviar.

# Salida de ingesta

```
{ "source": "email", "outcome": <EmailOutcome> }
{ "source": "change_digest", "since": "<ISO 8601>", "requests": [<StoredChangeRequest>, ...] }
{ "source": "trade_upload", "outcome": <TradeOutcome> }
```

Las fuentes de Personal necesitan `BOT_PERSONAL_ACCOUNT_ID`, porque ingesta no conoce cuentas. La de Trade necesita `BOT_ORDERS_FILE`, un archivo que traduce el `orderId` bytes32 a la etiqueta de la orden, las cuentas de las partes y la fecha límite. Ese archivo refleja las órdenes firmadas, nunca un documento.

| Salida de ingesta | Aviso |
| --- | --- |
| Personal, `escalated` | `invoice_needs_cosign`, con las dos lecturas de cada campo que no coincide |
| Personal, `held` (`parser_failed` o `extractor_failed`) | `invoice_held` |
| Personal, `change_requested` | `change_requested` |
| Personal, `changeDigest(since)` | `change_digest`: cantidad de solicitudes y alias |
| Personal, `quarantined`, `duplicate` o `ready` | nada (`ignored`) |
| Trade, `held` por `disagreement` | `operation_held` con motivo `two_source_mismatch` y las dos lecturas |
| Trade, `held` por `doc_type_mismatch` | `operation_held` con motivo `documents_mismatch` |
| Trade, `held` por `bl_used_by_other_order` | `operation_held` con motivo `bl_reused` |
| Trade, `held` por `parser_failed` o `extractor_failed` | `operation_held` con motivo `document_unreadable` |
| Trade, lectura con `alert` | `account_change_attempt` |
| Trade, `ready` sin `alert`, `rejected`, `quarantined` o `duplicate` | nada |

Las filas de Trade son el mapeo planeado: hoy `trade_upload` responde `501` y su traductor se escribe cuando el código de carga de documentos de Trade del Área 3 llegue a `dev`.

Nunca llegan al chat el dominio del remitente, las cuentas encontradas en un documento (`proposed` o `found`) ni texto de un correo o de un documento. De las dos lecturas que no coinciden solo se muestran los valores de forma fija (fechas, montos, monedas, incoterm, puertos, periodo, alias), revalidados. Los identificadores (números de documento, factura u orden, RUT, código arancelario) solo se nombran, porque en ellos cabe un teléfono. Los dos valores están en la app.

# Lo abierto

- **Motor (Área 2):** cómo llegan sus avisos (`payment_held`, `payment_deadline`, `operation_held`, `deadline_approaching`). Cada productor manda su propio código de motivo y un adaptador lo traduce al enum del bot. Esa traducción se acuerda con el Área 2. Para las retenciones de Trade ya hay tres motivos del motor, pedidos por el Área 2 en el PR #50: `FUNDING_BLOCKED` pasa a `funding_blocked`, `SIMULATION_REVERTED` a `simulation_failed`, y `ATTESTATION_UNKNOWN` e `IMPORTER_NOT_REGISTERED` a `agent_data_incomplete`. Llegan solo al dueño y al operador del importador, porque son fallas de su lado, y el mensaje no nombra ningún documento.
- **Resumen de solicitudes de cambio (Área 3):** alguien en ingesta debe ejecutar `changeDigest` periódicamente (por ejemplo, una vez al día) y mandarlo. Falta acordar si las solicitudes de cambio se avisan además una por una. Hoy el bot acepta las dos cosas, con tope por chat.
- **Eventos del escrow (Área 1):** el escucha de `OrderOpened`, `OrderFunded`, `AdvanceReleased` y los demás eventos de `TradeEscrow`, cuando exista, entrega por `POST /notices`.
