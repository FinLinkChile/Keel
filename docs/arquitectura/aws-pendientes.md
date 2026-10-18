---
type: Arquitectura
title: "Pendientes de la arquitectura en AWS"
description: "Qué falta construir por área para correr Keel Trade de punta a punta en AWS, qué decisiones abiertas toca y qué riesgos quedan declarados."
tags: [aws, pendientes, decisiones-abiertas, riesgos, area-2, area-3, area-4]
modo: trade
status: draft
generated: { by: claude-code/claude-sonnet-5-5, at: 2026-10-18T15:00:00Z }
---

**[PROPUESTA]** del Área 2 (Darienn), 18 de octubre de 2026. Es el resultado de revisar app, ingesta, bot, motor y contratos en `dev` y en las ramas abiertas (`area2/agent-service`, `area1/deploy-trade`). Ninguno de estos pendientes tiene tarea asignada todavía: asignarlos es del equipo ([trabajo](../trabajo/index.md)).

# Qué falta construir

| Área | Pendiente | Tipo |
| --- | --- | --- |
| 2 Motor | Handlers de una vuelta para agente y monitor (`--once` ya existe) | Nuevo |
| 2 Motor | `AgentStore` sobre DynamoDB y evidencia sobre S3, escrita antes de enviar | Nuevo |
| 2 Motor | Firmante de viem respaldado por KMS: `signTypedData` y `signTransaction` con firma normalizada | Nuevo |
| 2 Motor | Candado y nonce del relayer, y espera del recibo con límite o confirmación en la vuelta siguiente | Nuevo |
| 2 Motor | Indexador de eventos con cursor persistido, para la app y el bot | Nuevo |
| 2 Motor | Cursor y marca de pausa del monitor persistidos | Cambia |
| 2 Motor | Avisos a una cola SQS en lugar de un POST sin esperar respuesta | Cambia |
| 3 Ingesta | SQLite a DynamoDB con escrituras condicionales y transacciones | Cambia |
| 3 Ingesta | Carga por URL prefirmada y lectura asíncrona | Decidir |
| 3 Ingesta | Verificar en el extractor que el keccak256 del archivo subido sea el de la firma: S3 no calcula keccak256 y no puede obligarlo **[PROPUESTA]** | Nuevo |
| 3 Ingesta | Timeout explícito en los SDK del LLM: hoy ninguno lo fija y la API corta a los 29 s | Nuevo |
| 3 Ingesta | Ajustes en DynamoDB o Systems Manager, iguales para todas las instancias | Cambia |
| 3 Ingesta | Registro de transferencias de datos y `since` del resumen diario persistidos | Nuevo |
| 3 Ingesta | Registro de órdenes leído de la tabla Órdenes y no de un archivo | Cambia |
| 3 Ingesta | SES o reenviador para el correo entrante | Decidir |
| 4 Producto | API de propuestas y de consulta de órdenes: la app deja el `ProposalStore` local | Nuevo |
| 4 Producto | Interfaz de disputa, cancelación y `approveBalance`: hoy no existe | Nuevo |
| 4 Producto | Herramientas mínimas de la naviera y del árbitro para firmar | Nuevo |
| 4 Producto | Bot solo envía: se retiran el polling y los comandos `/start` y `/status` | Decidir |
| 4 Producto | Deduplicación, tope y retenciones del bot en DynamoDB | Cambia |
| 4 Producto | Alta de chats sin editar archivos ni variables a mano | Nuevo |
| 1 Contratos | `ConfigGuard` (T1.5): sin él un dueño puede saltarse el Delay | Nuevo |
| 1 Contratos | Publicar el despliegue en Systems Manager en cada release | Cambia |
| Equipo | Producción: REST API con AWS WAF y CloudFront delante; ahora HTTP API con throttling ([despliegue](despliegue-aws.md)) | Futuro: [promesa de seguridad](../flujo/mvp-y-seguridad-por-pais.md) |
| Equipo | Autenticación de personas con proveedores terceros legales de cada país: hoy la identidad de la app es simulada | Futuro **[ABIERTO]**: qué proveedor en cada país |

# Decisiones abiertas que toca

| Decisión | Qué toca |
| --- | --- |
| 1, red y token | El despliegue usa Base Sepolia (84532) y el USDC de prueba de Circle. El token lo confirma el Área 1 |
| 13, verificación del jurado | Con una red pública basta un explorador, pero la evidencia no es pública en producción |
| 15, dónde viven los datos fuera de la cadena | DynamoDB y S3 son la propuesta. También falta decidir quién llama `open` en el escrow: se propone que el agente lo haga en su vuelta. Esta decisión solo aparece en la rama `area2/agent-service` |
| Contrato de carga de documentos | Pasar a URL prefirmada y a respuesta asíncrona cambia [carga de documentos](../interfaces/carga-de-documentos.md) y [lectura de la proforma](../interfaces/lectura-de-proforma.md) |
| Registro de la empresa | Hoy el RUT y los datos del representante no salen del teléfono. Un `POST /companies` cambiaría esa decisión y la de [datos personales](datos-personales.md) |
| Modelo de pago | El dinero es una stablecoin. El modelo híbrido con un banco queda en la fase 2 del [alcance](../flujo/alcance.md) ([sistema de pago](../pagos/sistema-de-pago.md)) |

# Riesgos declarados

* **Una Safe y un relayer.** La cola por Safe no evita el choque de nonce si un mismo relayer sirve a varias Safes ([recorrido](aws-recorrido-de-una-orden.md)).
* **Umbral 1 en la Safe de demo.** Dos dueños con umbral 1: cualquiera de los dos mueve la Safe solo.
* **El agente reacciona con retraso.** Hasta unos 60 segundos entre que llegan los documentos y se presenta el embarque.
* **Límites de tamaño.** Un archivo de 10 MB en base64 no cabe en API Gateway ni en una Lambda síncrona: depende de la carga por URL prefirmada.
* **WAF no protege fondos.** Protege disponibilidad y costo; sin una firma válida nada se ejecuta y los contratos revierten igual.
* **Cosignatario y guardian robados** solo afectan la disponibilidad, como ya declara [amenazas](../flujo/amenazas.md).
