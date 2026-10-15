---
type: Interfaz
title: "Carga de documentos de una orden (Keel Trade)"
description: "Cómo sube la app el BL, la guía aérea o la factura de una orden a ingesta: mensaje EIP-712 que firma el representante, ruta HTTP, respuestas y registro de órdenes."
tags: [carga, documentos, eip-712, ingesta, app, t3-1]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T00:30:00Z }
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
