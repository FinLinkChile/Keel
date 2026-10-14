---
type: Área de trabajo
title: "Área 3: ingesta de documentos y extracción en cuarentena"
description: "Objetivo, entregables y tareas T3.1 a T3.8: canal autenticado, protección contra inundación, parser, extractor, concordancia, cambio de cuenta, idempotencia y corpus."
tags: [area-3, ingesta, extractor, parser, t3]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

**Perfil sugerido:** backend con experiencia en LLM, parsing de PDF y correo.
**Objetivo:** que nada de lo que llega en un correo o en un documento pueda convertirse en una cuenta de pago. Que las facturas legítimas se extraigan con la exactitud suficiente para pagar solas (Personal), y que los BL y facturas legítimos se lean con la exactitud suficiente para confirmar el embarque sin intervención (Trade).

# Entregables

* `ingest/` con canal de entrada autenticado, parser determinista, extractor en cuarentena y comparación entre ambos.
* Detección de cambio de cuenta: en Personal abre una solicitud de cambio y nunca un pago; en Trade abre una alerta y nunca un pago ni un cambio.
* Corpus de documentos legítimos y adversariales con etiquetas correctas, uno por modo.

# Tareas

**T3.1 Canal de entrada autenticado (crítica 10).**
* **Personal (base):** una casilla dedicada, por ejemplo con reenvío de correo a un webhook. Para cada correo se validan SPF, DKIM y DMARC, y se compara el dominio alineado con el dominio registrado para ese alias en el onboarding. Si falla, el correo queda en cuarentena y no se procesa; se registra en la bitácora con el motivo. Este canal ya está implementado.
* **Trade (agregado):** los documentos de una orden los sube una de sus partes desde la app, autenticada con su billetera. Se registra quién subió cada archivo y su hash. Si se acepta correo como canal secundario, pasa por la misma validación. Un documento que llega por correo nunca vale más que una lectura: no cambia nada de la orden.

**T3.2 Protección contra inundación (crítica 10).**
* **Personal (base):** máximo una solicitud de cambio de beneficiario pendiente por alias; límite de correos por remitente y por día; enfriamiento de 7 días tras un cambio rechazado o vetado.
* **Trade (agregado):** límite de documentos por orden y por día.
* En los dos modos: los duplicados se descartan por hash y las solicitudes o alertas se agrupan en un resumen en vez de notificarse una por una. Objetivo: que nadie firme por cansancio.

**T3.3 Parser determinista.**
* Extraer el texto del PDF y aplicar expresiones regulares.
  * **Personal (base):** RUT, folio, periodo, monto y vencimiento.
  * **Trade (agregado):** número de documento, fecha *on board*, puertos, número de factura, monto, moneda e incoterm. Como los BL no tienen formato estándar, el parser cubre los formatos del corpus (por ejemplo, dos navieras y una guía aérea) y se declara ese límite.
* Detectar texto oculto: color igual al fondo, tamaño menor a 4 puntos, fuera del área visible, capas superpuestas.
* Normalizar homoglifos (caracteres de otros alfabetos que se ven iguales) antes de comparar.

**T3.4 Extractor LLM en cuarentena.**
* Sin herramientas, temperatura 0 y salida estructurada con los esquemas estrictos de [extracción de documentos](../interfaces/extraccion-de-documentos.md).
* Nunca produce direcciones, cuentas ni nombres. En Personal, el modelo elige `alias_id` de un enum.
* Si el documento menciona una cuenta o un beneficiario distinto, solo marca `mentions_account_change = true`. En Personal, las direcciones encontradas las extrae el parser determinista y van **exclusivamente** al flujo de cambio de beneficiario (T3.6).
* Todo lo que no calce con el esquema se descarta y la factura o la operación queda retenida.

**T3.5 Concordancia de dos fuentes.**
* El extractor y el parser deben coincidir.
  * **Personal (base):** en RUT, folio, periodo y monto. Si hay diferencia, la factura queda en nivel 3.
  * **Trade (agregado):** en número de documento, fecha *on board*, monto y moneda. Si hay diferencia, la operación queda retenida.
* El aviso muestra los dos valores.
* Así se cubre el límite reconocido: un LLM manipulado puede devolver un valor falso dentro de un esquema válido.

**T3.6 Detección de cambio de cuenta.**
* **Personal (base):** genera una solicitud de cambio de beneficiario, no un pago. La solicitud incluye: dirección anterior y nueva, fuente, resultado de SPF/DKIM y hash del documento. Pasa al Área 4 (diff legible) y, si el dueño la confirma, al Delay del Área 1.
* **Trade (agregado):** genera una alerta, no un pago ni un cambio. La alerta incluye: fuente, canal, hash del documento y el recordatorio de que la cuenta de cobro solo cambia con una orden nueva firmada por ambas partes (D12). Se pasa al Área 4 para mostrarla.

**T3.7 Claves de idempotencia y de documento (crítica 11).**
* **Personal (base):** `invoiceKey = keccak256(issuer_tax_id, invoice_number, period)`, calculada con los valores normalizados. Reemplaza al hash del PDF, que se evade cambiando un píxel. Se deduplica al ingresar y además se hace cumplir en cadena (T1.6).
* **Trade (agregado):** `blNumberHash = keccak256(número de documento normalizado)`. Debe calcularse igual que en la atestación de la naviera, o el motor nunca dará conformidad. `docsHash = keccak256` del paquete de archivos, en un orden definido. La unicidad se hace cumplir en cadena: un BL no liquida dos órdenes (T1.9).

**T3.8 Corpus de documentos.**
* **Personal (base):**
  * Legítimas: al menos 12 facturas anonimizadas: luz, agua, internet, arriendo y gastos comunes, de 3 periodos distintos.
  * Adversariales: al menos 25 variantes: cuenta cambiada con el mismo formato, texto blanco con instrucciones, letra diminuta, homoglifos en el RUT, monto alterado, folio repetido con otro píxel, remitente falso que falla DKIM, correo legítimo reenviado con un adjunto cambiado, inyección en el campo del emisor.
* **Trade (agregado):**
  * Legítimos: al menos 12 conjuntos (BL o guía aérea más factura), anonimizados, coherentes con una orden de prueba cada uno.
  * Adversariales: al menos 25 variantes: factura con cuenta de cobro distinta, texto blanco con instrucciones, letra diminuta, homoglifos en el número de BL, fecha *on board* alterada, monto alterado, BL de otra orden, BL repetido con otro píxel, firma escaneada pegada, inyección en el campo del consignatario.
* Cada caso lleva su resultado esperado. Los corpus los usa el Área 5 para medir.

# Listo cuando

* Las 12 facturas legítimas de Personal se extraen bien de punta a punta.
* Los 12 conjuntos legítimos de Trade se leen bien de punta a punta y el motor los da por conformes.
* Ninguna variante adversarial produce un pago, una liberación de fondos ni un cambio de cuenta.
* Ningún dato del documento llega a un mensaje de Telegram ni a un PDR fuera de los campos tipados.

# Dependencias

* Recibe los esquemas del Área 2 (los de Trade, el miércoles 14), la tabla de alias con dominios y las órdenes de prueba del Área 4.
* Entrega extracciones al Área 2 y los corpus al Área 5 el viernes 16.

# Si falta tiempo

Se recortan el resumen diario (queda solo el límite de solicitudes pendientes), el canal de correo de Trade (queda solo la carga desde la app), la guía aérea (queda solo el BL marítimo) y la detección de capas superpuestas. **Nunca** se recortan el esquema sin texto libre, la concordancia de dos fuentes ni la validación SPF/DKIM del correo.
