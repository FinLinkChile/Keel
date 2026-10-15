---
type: Interfaz
title: "Esquemas de extracción de documentos"
description: "Salida del extractor en cuarentena, sin texto libre: factura de cuenta recurrente (Personal), documento de transporte y factura comercial (Trade)."
tags: [extraccion, json-schema, bl, factura]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T00:30:00Z }
---

**Personal (base).** Factura de una cuenta recurrente:

```json
{
  "alias_id": "ARRIENDO | LUZ | INTERNET | GASTOS_COMUNES",
  "issuer_tax_id": "RUT normalizado, sin puntos ni guion, regex ^[0-9]{7,8}[0-9K]$",
  "invoice_number": "regex ^[0-9]{1,12}$",
  "period": "regex ^20[0-9]{2}(0[1-9]|1[0-2])$",
  "amount_clp": "entero positivo",
  "due_date": "timestamp unix",
  "mentions_account_change": "boolean",
  "hidden_text_detected": "boolean"
}
```

No hay campo de nombre del emisor, notas ni dirección de destino. El nombre visible del beneficiario sale de la tabla de alias registrada en el onboarding, nunca de la factura.

**Trade (agregado).** Documento de transporte:

```json
{
  "doc_type": "BILL_OF_LADING | AIR_WAYBILL",
  "document_number": "regex ^[A-Z0-9]{6,20}$",
  "on_board_date": "timestamp unix",
  "port_of_loading": "UN/LOCODE, regex ^[A-Z]{2}[A-Z0-9]{3}$",
  "port_of_discharge": "UN/LOCODE, regex ^[A-Z]{2}[A-Z0-9]{3}$",
  "hidden_text_detected": "boolean"
}
```

Factura comercial:

```json
{
  "invoice_number": "regex ^[A-Z0-9]{1,20}$",
  "order_number": "regex ^[A-Z0-9]{1,20}$",
  "amount_minor": "entero positivo, en la unidad mínima de la moneda",
  "currency": "USD | EUR | CNY | HKD",
  "incoterm": "EXW | FOB | CIF | CFR",
  "importer_tax_id": "RUT normalizado, regex ^[0-9]{7,8}[0-9K]$",
  "hs_code": "código arancelario, regex ^[0-9]{6,10}$",
  "mentions_account_change": "boolean",
  "hidden_text_detected": "boolean"
}
```

No hay nombres, descripciones, notas, datos bancarios ni direcciones de destino. Lo que se muestra a las personas (nombre del proveedor, cuenta de cobro) sale de la orden firmada y del registro de partes, nunca del documento.

# Normalización en Keel Trade **[PROPUESTA]**

El parser y el extractor pasan por las mismas funciones (`ingest/src/trade/normalize.ts`), así que la concordancia de dos fuentes y los hashes ven una sola forma:

| Campo | Forma |
| --- | --- |
| `document_number` | Mayúsculas, sin espacios, guiones, barras ni puntos: `OLSU-2610 4471` queda `OLSU26104471`. Es el número que entra en `blNumberHash(carrier, number)`, así que **la atestación de la naviera tiene que construirse con esta misma forma** (Área 1 y quien firme por la naviera). Ingesta toma `carrier` de la orden firmada |
| `invoice_number`, `order_number` | La misma compactación |
| `amount_minor` | Solo el punto es separador decimal: `25,000.00` se lee; `25.000,00` se retiene en vez de adivinar |
| `on_board_date` | Medianoche UTC. Solo fechas sin ambigüedad (`12-OCT-2026`, `OCT 12, 2026`, `2026-10-12`). `10/12/2026` es 10 de diciembre en Chile y 12 de octubre en una plantilla de EE. UU.: se retiene |
| Puertos | UN/LOCODE. El parser reconoce el código impreso o los nombres de los puertos y aeropuertos del corredor (China, Hong Kong y Chile). Un lugar fuera de esa tabla se retiene |

Límite declarado: la compactación junta números que solo difieren en los separadores (`AB-12` y `AB1-2` quedan `AB12`). Con los formatos reales de BL (prefijo SCAC más dígitos) no ocurre, pero se declara.

Límite declarado: el parser lee documentos que imprimen cada campo después de su rótulo. Cubre los formatos del corpus (dos navieras y una aerolínea, en `redteam/corpus/trade`), no cualquier BL.
