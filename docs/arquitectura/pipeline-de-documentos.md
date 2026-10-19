---
type: Arquitectura
title: "Pipeline de documentos con extracción en cuarentena"
description: "Cómo se leen los documentos no confiables: LLM en cuarentena, parser determinista, concordancia y los límites que se declaran."
tags: [extractor, cuarentena, parser, prompt-injection, llm]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-16T02:30:00Z }
---

- Un LLM en cuarentena, sin herramientas, lee el contenido no confiable (PDF del BL, de la factura, de la proforma) y solo puede devolver un JSON de esquema fijo, sin texto libre: números de documento, fechas, montos, puertos y códigos.
- Un parser determinista extrae los mismos campos. Si no coinciden, la operación queda retenida.
- No hay LLM operativo (D2). Lo que sigue al extractor es un motor determinista.
- Limitación reconocida y resuelta: el patrón dual LLM (Willison, 2023) protege el flujo de control pero no el flujo de datos, como documenta CaMeL (Google DeepMind y ETH Zurich, arXiv 2503.18813). Un extractor manipulado puede devolver un valor falso dentro de un esquema válido. Por eso la defensa decisiva no está en el esquema sino en tres hechos: la cuenta de cobro nunca proviene de un documento, la prueba de embarque es una firma de la naviera y no un PDF, y el contrato solo paga a las partes de la orden.
- **La IA no valida firmas.** Una firma escaneada es una imagen. Las firmas válidas son criptográficas.
- Límite declarado: los BL no tienen formato estándar entre navieras. El prototipo cubre los formatos del corpus y los formularios de CSAV y Hapag-Lloyd (con el dato al lado o debajo de la etiqueta, y los términos al reverso), no cualquier BL. Detalle en [extracción de documentos](../interfaces/extraccion-de-documentos.md).
- En el pitch se dice explícitamente: asumimos que la IA puede fallar, y demostramos que aun así el contrato rechaza.

Los esquemas de salida están en [extracción de documentos](../interfaces/extraccion-de-documentos.md). La implementación es trabajo del [Área 3](../trabajo/area-3-ingesta.md).
