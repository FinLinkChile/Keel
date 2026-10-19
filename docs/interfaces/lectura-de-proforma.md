---
type: Interfaz
title: "Lectura de la proforma (Keel Trade)"
description: "Cómo sube la app la proforma del exportador para prellenar la orden: mensaje EIP-712 que firma el importador, ruta HTTP, archivos aceptados, campos que devuelve y qué nunca devuelve."
tags: [proforma, eip-712, ingesta, app, t3-9, paso-0]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T07:00:00Z }
---

Diseño del Área 3 (T3.9) para la pantalla de nueva orden del Área 4 (T4.9), confirmado por el Área 4 al aprobar el PR #66. El código está en `ingest/src/trade/proforma.ts` y `ingest/src/extractor/proforma.ts`. El envío de fotos y escaneos al modelo sin redactar sigue **[PROPUESTA]** hasta que lo confirme el equipo.

Sirve al [paso 0](../flujo/paso-0-negociacion.md): el agente lee la proforma y propone la orden estructurada, y quienes la aprueban y firman son las personas. La lectura solo prellena la pantalla de revisión; **lo que vale es la orden firmada por ambas partes**.

# Qué firma el importador

```
ProformaUpload(bytes32 fileHash,uint64 issuedAt)
```

| Campo | Valor |
| --- | --- |
| `fileHash` | keccak256 de los bytes exactos del archivo |
| `issuedAt` | Segundos unix, con hasta 10 minutos de diferencia con el reloj del servidor |

Mismo dominio que la [carga de documentos](carga-de-documentos.md): `{ name: "Keel Ingest", version: "1", chainId }`. El tipo primario es otro, así que una firma de proforma no sirve como carga de documento ni al revés. No lleva `orderId`, porque la orden todavía no existe.

Puede subir una proforma un representante del importador: en el prototipo, los `uploaders` con `party: "importer"` del registro de órdenes, más las direcciones de `INGEST_IMPORTERS_FILE` (un arreglo JSON de direcciones) para un importador que aún no tiene órdenes.

# Ruta

`POST /trade/proforma`, con un cuerpo JSON:

```json
{ "issuedAt": 1791936000, "signature": "0x…", "file": "<PDF o imagen en base64>" }
```

Existe junto con la ruta de carga de documentos (con `INGEST_ORDERS_FILE` e `INGEST_CHAIN_ID`) y responde CORS igual que ella, solo para `INGEST_APP_ORIGIN`.

**Archivos aceptados.** El tipo se lee de los bytes, no de lo que declara la app. El encabezado `%PDF-` puede estar en cualquier parte del primer KB, como permite el estándar, porque algunos escáneres escriben bytes antes:

| Archivo | Cómo se lee |
| --- | --- |
| PDF con texto (al menos 200 caracteres visibles) | Como los demás documentos: el modelo recibe solo el texto, con RUT, cuentas y billeteras reemplazados por tokens. El detector de texto oculto del parser se suma a la marca del modelo |
| PDF escaneado (sin texto), como el del escáner de Notas | El archivo va al modelo |
| Foto JPEG, PNG o WebP, hasta 5 MB | El archivo va al modelo. HEIC no se acepta: la app envía JPEG |

Cuando el archivo va al modelo no hay texto que redactar: la transferencia queda registrada como `documento_sin_redactar`, con la finalidad `extraccion_proforma`. El proveedor compatible con OpenAI no lee PDF escaneados (`unsupported_input`).

| Respuesta | Cuándo |
| --- | --- |
| 400 `invalid_request` | El cuerpo no tiene la forma esperada |
| 401 `bad_signature`, 401 `stale_signature` | Firma ilegible, o `issuedAt` fuera de la ventana |
| 403 `not_an_importer` | Quien firmó no es un importador registrado, o el archivo no es el firmado |
| 413 `too_large` | PDF de más de 10 MB o imagen de más de 5 MB |
| 415 `unsupported_media` | No es PDF, JPEG, PNG ni WebP |
| 429 `rate_limited` | Más de 20 proformas por importador en 24 horas |
| 200 `read` | La lectura, con `input` (`text` o `file`), `proforma` y `missing` |
| 200 `unreadable` | El modelo no pudo leerla (`refused`, `invalid_output`, `provider_error`…): el importador llena la orden a mano |

# Qué devuelve

```json
{
  "status": "read",
  "fileHash": "0x…",
  "input": "text",
  "proforma": {
    "proforma_number": "PI20260142",
    "issue_date": 1790899200,
    "currency": "USD",
    "amount_minor": 2000000,
    "incoterm": "FOB",
    "hs_codes": ["820750", "846721"],
    "latest_shipment_date": 1794700800,
    "port_of_loading": "CNNGB",
    "port_of_discharge": null,
    "advance_bps": 3000,
    "lines": [
      { "hs_code": "846721", "quantity": 400, "unit": "PCE", "amount_minor": 1400000 },
      { "hs_code": "820750", "quantity": 500, "unit": "SET", "amount_minor": 600000 }
    ],
    "mentions_account_change": false,
    "hidden_text_detected": false
  },
  "missing": ["port_of_discharge"]
}
```

- Un campo que la proforma no imprime llega como `null` y aparece en `missing`, para que el importador lo llene. Nunca se adivina ni se calcula.
- Los valores pasan por las mismas normalizaciones que el BL y la factura: número compactado, monto en unidades menores sin decimales flotantes, fechas a medianoche UTC, códigos HS solo con dígitos (de 6 a 10), puertos en UN/LOCODE. Un valor que no se normaliza no se muestra como una suposición: ese campo llega como `null` y en `missing`, y los demás se conservan. Si falla un código HS, la lista queda vacía entera, para no mostrar una lista incompleta como si estuviera completa. Una respuesta que rompe el esquema (un campo de más, un tipo distinto) deja la lectura completa `unreadable`.
- `lines` **[PROPUESTA]** trae cada línea de mercadería con su código HS, cantidad, unidad y monto, **sin descripción ni otro texto**, para comparar precios por unidad (nota del agente en la app). La unidad es un código de la Recomendación 20 de UN/ECE de una lista cerrada: `KGM` kilo, `TNE` tonelada, `GRM` gramo, `LBR` libra, `PCE` unidad, `SET` juego, `PR` par, `DZN` docena, `CT` caja, `BG` saco, `RO` rollo, `LTR` litro, `MTR` metro, `MTK` metro cuadrado, `MTQ` metro cúbico. La cantidad es positiva con hasta 3 decimales; el código HS y el monto de una línea pueden llegar en `null`. Igual que con los códigos HS, si una línea no se normaliza (unidad fuera de la lista, cantidad que no es un número) la lista llega vacía entera, para no mostrarla incompleta, y `lines` aparece en `missing`. Hasta 20 líneas. Una lectura guardada antes de este campo vuelve con `lines: []`.
- `mentions_account_change` y `hidden_text_detected` son advertencias para la pantalla. No llenan nada.
- `fileHash` es el `documentHash` de los `OrderTerms` de la orden que sale de esta proforma; así lo usa la app ([paso 1](../flujo/paso-1-firma-orden.md)).
- La misma proforma subida otra vez devuelve la misma lectura sin llamar de nuevo al modelo. Ingesta guarda el hash y la lectura tipada, nunca el archivo.

**Lo que nunca devuelve:** la cuenta de cobro, nombres, direcciones ni texto libre. La cuenta de cobro de la orden sale del registro del proveedor verificado ([principio 1](../flujo/principios.md)); una proforma que imprime otra cuenta solo levanta `mentions_account_change`.

# Por qué basta un lector

El BL y la factura deciden un pago, y por eso se leen dos veces (parser y modelo) y deben coincidir. La proforma no decide nada: la revisión de cada campo antes de firmar (T4.2) cumple el papel del segundo lector, y una foto no tiene texto para un parser. Si el modelo es engañado, lo peor que logra es prellenar un valor que la persona ve antes de firmar, y que el motor vuelve a comparar con la factura en el gatillo 2.
