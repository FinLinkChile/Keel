---
type: Interfaz
title: "Esquemas de extracción de documentos"
description: "Salida del extractor en cuarentena, sin texto libre: factura de cuenta recurrente (Personal), documento de transporte y factura comercial (Trade)."
tags: [extraccion, json-schema, bl, factura]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
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
