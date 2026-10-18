---
type: Interfaz
title: "Carga de documentos de una orden (Keel Trade)"
description: "Cómo sube la app el BL, la guía aérea o la factura de una orden a ingesta: mensaje EIP-712 que firma el representante, ruta HTTP, respuestas y registro de órdenes."
tags: [carga, documentos, eip-712, ingesta, app, t3-1]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T22:00:00Z }
---

**[PROPUESTA]** Diseño del Área 3 (T3.1) para que lo use el Área 4. El código ya existe en `ingest/src/trade/` **[HECHO]**. Está por confirmar con el Área 4.

# Qué firma el representante

Para subir un documento a una orden, un representante de una de sus partes firma con su billetera un mensaje EIP-712:

```
DocumentUpload(bytes32 orderId,string docType,bytes32 fileHash,uint64 issuedAt)
```

| Campo | Valor |
| --- | --- |
| `orderId` | El de la orden firmada |
| `docType` | `BILL_OF_LADING`, `AIR_WAYBILL` o `COMMERCIAL_INVOICE` (`REQUIRED_DOC_TYPES` de `@keel/schemas`) |
| `fileHash` | keccak256 de los bytes exactos del PDF. Es el mismo hash que entra en `docsHash` |
| `issuedAt` | Segundos unix. Se acepta con hasta 10 minutos de diferencia con el reloj del servidor |

Dominio: `{ name: "Keel Ingest", version: "1", chainId }`, sin `verifyingContract`, porque la firma se verifica fuera de la cadena. El nombre es distinto de `"Keel"` a propósito: así una firma de carga nunca sirve como uno de los structs que verifican los contratos.

Como la firma cubre el hash que calcula el servidor con los bytes que recibe, un archivo cambiado después de firmar recupera otra dirección y se rechaza.

# Ruta

`POST /trade/documents`, con un cuerpo JSON:

```json
{ "orderId": "0x…", "docType": "COMMERCIAL_INVOICE", "issuedAt": 1791936000, "signature": "0x…", "file": "<PDF en base64>" }
```

La firma es la autenticación: no hay token. La ruta solo existe si ingesta tiene un registro de órdenes (`INGEST_ORDERS_FILE` e `INGEST_CHAIN_ID`).

Si la app sube desde el navegador, ingesta responde CORS solo para el origen exacto que se configure en `INGEST_APP_ORIGIN` (https, salvo localhost) y solo en esta ruta. No se usan cookies.

| Respuesta | Cuándo |
| --- | --- |
| 400 `invalid_request` | El cuerpo no tiene la forma esperada |
| 400 `unknown_doc_type`, 404 `unknown_order` | Tipo de documento u orden desconocidos |
| 401 `bad_signature`, 401 `stale_signature` | Firma ilegible, o `issuedAt` fuera de la ventana |
| 403 `not_a_party` | Quien firmó no es representante de la orden, o el archivo no es el firmado |
| 413 `too_large` | Más de 10 MB |
| 200 | Cualquier otro resultado, con `status`: `ready`, `held`, `duplicate` o `quarantined` |

Un `ready` trae la extracción tipada y, si corresponde, una `alert` de cambio de cuenta ([T3.6](../trabajo/area-3-ingesta.md)). Un `held` trae el motivo: `disagreement` (con los dos valores), `parser_failed`, `extractor_failed`, `doc_type_mismatch` o `bl_used_by_other_order`. Nada de lo que devuelve esta ruta paga, libera fondos ni cambia la orden.

# Registro de órdenes

Por cada orden, ingesta necesita saber quién puede subir documentos y adónde se le paga al exportador:

```json
{ "orderId": "0x…", "payoutAddress": "0x…", "carrier": "0x…", "uploaders": [{ "address": "0x…", "party": "exporter" }], "knownDestinations": [{ "kind": "bank_account", "value": "6228480122334455" }] }
```

- `payoutAddress` y `carrier` vienen de la orden firmada, nunca de un documento. `carrier` entra en `blNumberHash(carrier, number)`: un número de BL es único por naviera.
- `uploaders` son billeteras de personas (EOA). Una Safe no puede firmar aquí: firman sus dueños o el encargado de compras. La verificación ERC-1271 de una Safe queda como trabajo futuro.
- `knownDestinations` son las cuentas registradas del exportador. Una factura que las imprime no levanta alerta.

En el prototipo el registro es un archivo. **[ABIERTO]** Quién lo mantiene y si debería leerse de los eventos `OrderOpened` del escrow (ver [decisiones abiertas](../decisiones/abiertas.md)).

# Paquete de documentos

Cuando hay un documento aceptado por cada tipo exigido en la orden, `IngestStore.tradePackage(orderId, requiredDocs)` devuelve el `docsHash` (helper `docsHash` de `@keel/schemas/hash`), el `blNumberHash` y las extracciones. Eso es lo que el motor (Área 2) compara con la orden y con la atestación de la naviera para emitir el `DocumentDecision` del [paso 5](../flujo/paso-5-saldo.md). Si hay dos documentos aceptados del mismo tipo, el paquete queda `ambiguous` y decide una persona.

# En AWS **[PROPUESTA]**

En la rama `AWS` la carga pasa a URL prefirmada de S3 con lectura asíncrona ([despliegue en AWS](../arquitectura/despliegue-aws.md)). La firma `DocumentUpload` y su dominio no cambian; cambian la ruta y la respuesta. Afecta a las Áreas 3 y 4.

`POST /trade/uploads`, sin archivo:

```json
{ "orderId": "0x…", "docType": "BILL_OF_LADING", "fileHash": "0x…", "size": 482113, "issuedAt": 1791936000, "signature": "0x…" }
```

* `size` es nuevo: la URL firma el `content-length`, así que se suben exactamente esos bytes. Más de 10 MB responde 413 `too_large`.
* 200 `{ "uploadUrl", "key": "orders/<orderId>/<fileHash>", "expiresIn": 300 }`. La app sube los bytes con `PUT` a `uploadUrl`. Pedir de nuevo una URL para el mismo archivo aún no leído, o cuya lectura terminó en `held` por `extractor_failed`, devuelve otra, sin contar para el límite diario.
* Rechazos: `{ "status": "rejected", "reason" }` con los códigos de arriba; 429 `quarantined` / `rate_limited` al pasar de 10 cargas por orden, por parte y por día (la cuota es de cada parte, así que el importador no puede agotar la del exportador); 409 `duplicate` / `same_file`.
* El resultado de la lectura llega después como aviso del bot y en `GET /orders/{orderId}` (`documents.fileHashes`), no en esta respuesta.

La lectura la hace una Lambda en cuarentena que recibe el evento de S3. Antes de leer recalcula el keccak256 del archivo: si no es el `fileHash` firmado, borra el objeto y no lee nada. S3 no calcula keccak256, así que ese control vive en el extractor. Una falla pasajera del proveedor del LLM (timeout, 429) no cierra la lectura: se reintenta y solo al tercer intento llega el aviso `held` / `extractor_failed`, después del cual se puede volver a subir el mismo archivo. Si el aviso no se pudo encolar, la lectura no se da por terminada y se reintenta.

`POST /trade/documents` sigue por compatibilidad, con el archivo en base64, y responde 202 `{ "status": "accepted_for_reading", "orderId", "fileHash" }`. Una Lambda síncrona recibe como máximo 6 MB, así que esta ruta acepta un cuerpo de hasta 5,5 MB: un PDF de unos 4 MB. Un archivo más grande va por `POST /trade/uploads`. Si guardar el archivo falla, la misma carga se puede reintentar sin contar para el límite.

El registro de órdenes ya no es un archivo: lo escribe la Lambda de alta de orden en la tabla de ingesta (`order#<orderId>` / `entry`) cuando la propuesta tiene las dos firmas. En DynamoDB los límites diarios cuentan por día UTC; en SQLite, las últimas 24 horas. El registro de AWS no trae `knownDestinations` (cuentas registradas del exportador), así que en AWS una factura que imprime una cuenta levanta la alerta de cambio de cuenta ([T3.6](../trabajo/area-3-ingesta.md)) aunque la cuenta sea la conocida.
