---
type: Arquitectura
title: "Componentes de la arquitectura en AWS"
description: "Qué servicio de AWS cumple cada función de Keel Trade, qué hace, qué es hoy en el repo y si existe, es nuevo, cambia o falta decidirlo."
tags: [aws, serverless, componentes, lambda, dynamodb, sqs, s3, kms]
modo: trade
status: draft
generated: { by: claude-code/claude-sonnet-5-5, at: 2026-10-18T15:00:00Z }
---

**[PROPUESTA]** del Área 2 (Darienn), 18 de octubre de 2026. Falta que el equipo la confirme. El panorama general y las reglas de entrada a la API están en [despliegue en AWS](despliegue-aws.md); el diagrama interactivo, en el artifact [Keel en AWS](https://claude.ai/artifact/Vt92pMCFZFGcJUhnCKwYXY).

Cada fila dice qué servicio cumple la función y su estado:

* **Existe**: la lógica ya está en el repo y solo cambia dónde corre.
* **Cambia**: existe y hay que modificarlo para correr en AWS.
* **Nuevo**: no existe hoy.
* **Decidir**: toca una decisión abierta o de otra área.

# Entrada

| Componente | Servicio | Qué hace | Hoy en el repo | Estado |
| --- | --- | --- | --- | --- |
| API HTTP | API Gateway | Puerta pública única. Throttling por ruta ahora y REST API con WAF en producción | Cada servicio abre su puerto con `createServer` | Decidir: tasa y ráfaga |
| Recepción de correo | SES o reenviador | Deja el correo en S3 para la Lambda de correo | Reenviador externo contra `POST /inbound` | Decidir: DMARC necesita la IP, el HELO y el MAIL FROM reales |
| Programador | EventBridge Scheduler | `rate(1 minute)` para el reparto, el monitor y el indexador; cron diario para el resumen | Bucles `for(;;)` de 15 s en `engine/src/cli.ts` y un `setInterval` de 24 h en ingesta | Cambia |

# Órdenes (Áreas 4 y 2)

| Componente | Servicio | Qué hace | Hoy en el repo | Estado |
| --- | --- | --- | --- | --- |
| Propuestas | Lambda | Intercambio de la orden entre dos teléfonos: crear, firmar, rechazar | `ProposalStore` local de la app (`app/src/data/proposals.ts`) | Nuevo |
| Consulta de órdenes | Lambda | Lista y detalle de órdenes, pendientes y saldos. El estado sale del indexador | Datos de `app/src/data/mock.ts` | Nuevo |
| Firmas de cierre | Lambda | Recibe `approveBalance`, las firmas de cancelación y la resolución del árbitro; el agente las envía | No existe | Nuevo |
| Alta de orden | Lambda con DynamoDB Stream | Cuando la propuesta tiene las dos firmas, da de alta la orden para el agente y para ingesta | Archivos `order.json` e `INGEST_ORDERS_FILE` cargados a mano | Nuevo y decidir: decisión 15 |
| Directorio | Lambda | Proveedores verificados y configuración del corredor (token, naviera, árbitro, verificador) | Listas fijas en `mock.ts` | Nuevo |
| Atestaciones | Lambda | Recibe la atestación de embarque firmada por la naviera | `shipment.json` en disco | Nuevo |
| Propuestas | DynamoDB con Stream | Una fila por propuesta con firmas y estado. El Stream avisa cuando queda firmada | Archivo en el teléfono | Nuevo |
| Órdenes | DynamoDB | Orden firmada, términos, quién sube documentos, atestación, extracciones, firmas de cierre, registro de partes, historial de montos y estado indexado | `registry.json`, `order.json`, `shipment.json` y `documents.json` del `AgentStore` (rama `area2/agent-service`) | Nuevo y decidir: decisión 15 |

# Ingesta (Área 3)

| Componente | Servicio | Qué hace | Hoy en el repo | Estado |
| --- | --- | --- | --- | --- |
| Carga de documentos | Lambda | Revisa la firma `DocumentUpload` y entrega una URL prefirmada de S3 | `POST /trade/documents` con el archivo en base64 | Decidir: cambia el contrato de [carga de documentos](../interfaces/carga-de-documentos.md) |
| Correo | Lambda | Autentica el correo, deduplica, limita por remitente, guarda los adjuntos y encola su lectura | `receiveEmail` en `ingest/src/email/` | Cambia |
| Proforma | Lambda | Lee la proforma y devuelve campos tipados | `ingest/src/trade/proforma.ts` | Cambia: timeout del LLM |
| Documentos | S3 | Archivos originales, cifrados y con versionado | Ingesta no guardaba archivos, solo hashes | Nuevo |
| Cola de lectura | SQS con cola de fallidos | Un mensaje por documento | La lectura ocurre en la misma petición | Nuevo |
| Ajustes de ingesta | Lambda | Proveedor y modelo del LLM y exigencia de DMARC, con auditoría de cada cambio | `INGEST_SETTINGS_FILE` cacheado por proceso | Cambia |
| Extractor | Lambda en cuarentena | El único lugar con LLM: redacta, llama al modelo, valida con el parser y guarda la extracción | `ingest/src/extractor/`, `parser.ts` y `privacy.ts` | Cambia: persistir el registro de transferencias ([datos personales](datos-personales.md)) |
| Resumen diario | Lambda con cron | Junta las solicitudes de cambio de cuenta del día y las manda al bot | `setInterval` con el `since` en memoria (`ingest/src/botNotifier.ts`) | Cambia |
| Tablas de ingesta | DynamoDB | Correos vistos, facturas, solicitudes de cambio, cargas, BL únicos, lecturas de proforma, ajustes, auditoría y registro de transferencias | SQLite local (`ingest/src/store.ts`) | Cambia |

# Agente (Área 2)

| Componente | Servicio | Qué hace | Hoy en el repo | Estado |
| --- | --- | --- | --- | --- |
| Reparto por Safe | Lambda | Cada minuto lista las Safes con órdenes vivas y deja un mensaje "revisa esta Safe" por cada una | El agente recorre todas las órdenes en un solo proceso | Nuevo |
| Vueltas por Safe | SQS FIFO | Un carril por Safe (`MessageGroupId` igual a la dirección de la Safe) | No hace falta con un proceso único | Nuevo |
| Agente | Lambda con `@keel/engine` | Una vuelta por Safe: abre, deposita, presenta el embarque, libera el saldo, reembolsa y envía las firmas de cierre | `engine/src/agent/agent.ts` (`keel agent --once` ya existe) | Cambia |
| Indexador | Lambda | Lee los eventos de los contratos y deja el estado de cada orden | No existe | Nuevo |
| Monitor | Lambda con `@keel/engine` | Detecta depósitos sin evidencia de Keel y envía `emergencyPause` | `engine/src/monitor/monitor.ts` | Cambia |
| Estado del agente | DynamoDB | Cursores del monitor y del indexador, candado y nonce, avisos enviados con caducidad, marca de pausa | Memoria del proceso | Nuevo |
| Evidencia de PDR | S3 con Object Lock | Un archivo por PDR, escrito antes de enviar la transacción | `evidence/pdr/` escrito con `writeFileSync` | Cambia |

# Avisos (Área 4)

| Componente | Servicio | Qué hace | Hoy en el repo | Estado |
| --- | --- | --- | --- | --- |
| Cola de avisos | SQS con cola de fallidos | Agente, monitor, ingesta y alta de orden publican avisos con id determinista | `POST /notices` y `POST /ingest/outcomes` con timeout de 3 s y sin reintento | Nuevo |
| Envío de avisos | Lambda con grammY | Arma la plantilla tipada por lado y rol, aplica el tope por chat y las retenciones, y envía con `sendMessage` | `bot/src/application/notify.ts` | Cambia y decidir: se retiran `/start` y `/status` |
| Directorio del bot | DynamoDB | Chats por rol, etiquetas de orden, avisos vistos con caducidad, contadores por hora y retenciones | `BOT_RECIPIENTS_FILE`, `BOT_ORDERS_FILE` y memoria | Nuevo |

# Plataforma

| Componente | Servicio | Qué hace | Hoy en el repo | Estado |
| --- | --- | --- | --- | --- |
| Llaves de firma | KMS secp256k1 | Tres llaves de servidor que no salen de KMS ([llaves y secretos](aws-llaves-y-secretos.md)) | Variables de entorno cargadas por `engine/src/keys.ts` | Nuevo |
| Secretos | Secrets Manager | Credenciales que no mueven fondos | `.env` fuera de git | Cambia |
| Configuración | Systems Manager | Despliegue, direcciones, `chainId`, URL de RPC y parámetros de política | `contracts/deployments/84532.json` y variables `KEEL_*` | Cambia |
| Registros y alarmas | CloudWatch | Registros con campos tipados y alarmas: colas de fallidos, `AGENT_ERROR`, saldo de gas del relayer y pausas | JSON por stderr | Cambia |

# Fuera de AWS

| Componente | Qué es |
| --- | --- |
| Proveedor del LLM | Anthropic, OpenAI, Gemini o uno compatible, según los ajustes de ingesta |
| URL de RPC | Lo único que AWS sabe de la red: ver [stack](stack.md) |
| Contratos Keel | Safe con Roles y Delay, FundingGate y TradeEscrow en Base Sepolia (84532), en `contracts/deployments/84532.json` |
| Telegram | Solo recibe los avisos: el sistema no recibe nada desde Telegram |

El detalle de rutas y tablas está en [API y datos](aws-api-y-datos.md), y cómo recorre una orden estas piezas, en [recorrido de una orden](aws-recorrido-de-una-orden.md).
