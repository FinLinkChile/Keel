---
type: Arquitectura
title: "Datos personales y privacidad (Ley 21.719)"
description: "Qué datos de personas y empresas guarda Keel, dónde vive cada uno, para qué, a quién se transfiere, qué queda en la cadena, qué pueden usar los análisis y qué falta definir."
tags: [privacidad, datos-personales, ley-21719, analisis, cadena]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T07:30:00Z }
---

**[PROPUESTA]** del Área 3 (Daniela). Reúne lo que ya hace el código y lo que falta decidir. Los datos de personas (representantes, firmantes, operadores) caen bajo la Ley 21.719, que según el [documento de negocio](../negocio/Keel%20opciones%20de%20negocio%20y%20an%C3%A1lisis%20de%20datos.md) entra en vigencia el 1 de diciembre de 2026, con un proyecto para postergarla. **[ABIERTO: verificar la fecha antes de citarla.]**

# Reglas que ya se cumplen

* **Nada personal va a la cadena.** Los contratos guardan direcciones, montos, fechas y hashes, nunca nombres ni RUT.
* **Nada personal llega al modelo en un texto.** Ingesta reemplaza nombres, direcciones, correos, RUT, teléfonos, cuentas, IBAN, tarjetas y billeteras por tokens antes de enviar el texto de un documento, y solo rehidrata los campos tipados que devuelve el extractor (`ingest/src/privacy.ts`, patrones `PII_PATTERNS`, sobre `privacy-kit-cl`). Cada token usa una sal nueva por llamada, para que un proveedor no pueda recuperar un RUT por fuerza bruta.
* **Ingesta no guarda archivos.** De cada documento queda su hash, quién lo subió y los campos tipados; de la proforma, el hash y la lectura ([lectura de la proforma](../interfaces/lectura-de-proforma.md)).
* **Las llaves no salen del teléfono** ([custodia de llaves](custodia-de-llaves.md)).

# Qué datos existen y dónde viven

| Dato | De quién | Dónde | Para qué | Quién lo ve |
| --- | --- | --- | --- | --- |
| Nombre, RUT y si es persona expuesta políticamente | Representante legal | Solo el teléfono (`onboarding.json`) | Registro; la validación de identidad es simulada | Nadie fuera del teléfono |
| Correo y celular de la empresa | Pueden ser de una persona | Solo el teléfono | Registro | Nadie fuera del teléfono |
| RUT de la empresa | Empresa (en una empresa individual, es el RUT de una persona) | Teléfono, registro del agente, extracción de la factura (`importer_tax_id`) | Comparar la factura con la orden | Ingesta y el agente |
| Llave privada | Cada rol | Almacén seguro del teléfono | Firmar | Nadie |
| Dirección de billetera | Empresa, o persona en Keel Personal | Teléfono, ingesta (quién subió), cadena | Firmar y autorizar | Pública en la cadena |
| ID de chat de Telegram por rol | Dueño, operador, cosignatario | Directorio del bot | Avisos | Operador del bot |
| Texto de documentos (BL, factura, proforma) | Puede nombrar personas | No se guarda | Extracción | El modelo, redactado |
| Foto o escaneo de la proforma | Puede mostrar personas | No se guarda | Extracción | El modelo, **sin redactar** **[PROPUESTA]**: se registra como `documento_sin_redactar` con la finalidad `extraccion_proforma` |
| Órdenes, marcas de tiempo y lo que pidió la proforma | Empresa | Teléfono y cadena | Firmar, seguir la orden, análisis | La empresa; lo de la cadena, cualquiera |
| Correos y facturas de Keel Personal | Persona | Ingesta guarda hash del mensaje, dominio del remitente y clave de la factura, no el contenido | Idempotencia y límites | Ingesta |

# Lo que se ve en la cadena

Base Sepolia es una red **pública**: cualquiera puede leer las direcciones de las partes, los montos, las fechas de depósito y de embarque, el puerto de carga y los hashes de cada orden. No hay datos personales, pero sí información comercial: quién le compra a quién, cuánto y cuándo, si alguien vincula una dirección con una empresa. Una red cerrada lo limitaría ([decisión abierta 1](../decisiones/abiertas.md)). Como en la cadena nada se puede borrar, **ningún dato personal debe llegar a ella**, tampoco en una versión futura.

# A quién se transfiere

| Destino | Rol | País | Base | Finalidad |
| --- | --- | --- | --- | --- |
| Anthropic, OpenAI, Gemini | Encargado | Estados Unidos | Contrato | `extraccion_factura`, `extraccion_documento_comercio`, `extraccion_proforma` |
| Proxy compatible con Anthropic (LiteLLM) u otro proveedor compatible | Encargado | Por confirmar | Contrato | Las mismas |

Cada envío queda registrado con su destino y finalidad (`logTransfer`, `ingest/src/extractor/index.ts`).

# Qué pueden usar los análisis

* **Dentro de una empresa** (notas del agente, panel, puntaje del proveedor, negociación): trabajan con órdenes y empresas, nunca con datos del representante, y corren en el teléfono.
* **Entre empresas** (puntaje compartido de un proveedor, comparación con empresas parecidas) **[PROPUESTA]**: solo agregados, y solo cuando el grupo tiene al menos 5 empresas, para que ninguna se pueda identificar.
* **Puntaje de crédito para un banco** **[PROPUESTA]**: es una finalidad distinta de la que tuvo la recolección, así que exige el consentimiento explícito de la empresa antes de compartir nada.

# Lo que falta definir **[ABIERTO]**

* Plazos de conservación de cada dato, en el teléfono, en ingesta y en el registro del agente.
* Cómo se ejercen los derechos de acceso, rectificación y supresión. Hoy "Sign up again" borra el registro del teléfono; ingesta no guarda datos de personas, salvo direcciones y el directorio del bot.
* Aviso de privacidad y texto de consentimiento en el registro de la app.
* Quién es el responsable del tratamiento y su contacto.
* Si las fotos y escaneos de la proforma pueden ir sin redactar al modelo, o si hace falta redactar la imagen.
