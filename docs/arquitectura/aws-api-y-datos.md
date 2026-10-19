---
type: Arquitectura
title: "API y datos en AWS"
description: "Las rutas de la API de Keel Trade en AWS con quién las llama y cómo se autentica cada una, y las tablas y buckets que reemplazan a los archivos y al SQLite de hoy."
tags: [aws, api, rutas, dynamodb, s3, autenticacion]
modo: trade
status: draft
generated: { by: claude-code/claude-sonnet-5-5, at: 2026-10-18T15:00:00Z }
---

**[PROPUESTA]** del Área 2 (Darienn), 18 de octubre de 2026. Las rutas marcadas Nuevo no existen hoy: salen de lo que la app necesita para operar con dos teléfonos reales. Qué función las sirve está en [componentes](aws-componentes.md).

# Rutas

La regla común: la API no decide nada y cada ruta exige su firma o su token. Una petición firmada lleva una firma EIP-712 de la billetera, con el mismo patrón de la carga de documentos (dominio "Keel Ingest", validez de 10 minutos). Así el servidor sabe quién pregunta sin contraseñas ni cuentas.

| Método | Ruta | Función | Quién llama | Autenticación | Estado |
| --- | --- | --- | --- | --- | --- |
| POST | `/proposals` | Propuestas | Importador | Petición firmada | Nuevo |
| GET | `/proposals`, `/proposals/{orderId}` | Propuestas | Las partes | Petición firmada | Nuevo |
| POST | `/proposals/{orderId}/exporter-signature`, `/importer-signature`, `/reject` | Propuestas | Exportador o importador | Firma de la `PurchaseOrder` | Nuevo |
| GET | `/orders`, `/orders/{orderId}` | Consulta de órdenes | Las partes | Petición firmada | Nuevo |
| GET | `/needs-you`, `/wallet` | Consulta de órdenes | Importador o exportador | Petición firmada | Nuevo. `/wallet` incluye `available`, el saldo del token de la Safe leído en la cadena, y `payouts`, el saldo de cada dirección de cobro de las órdenes del exportador; si el RPC no responde, la ruta contesta sin esos saldos |
| GET | `/suppliers` | Directorio | Importador | Petición firmada | Nuevo |
| GET | `/trade-setup` | Directorio | Cualquiera (datos públicos del despliegue: escrow, gate, Safe, token, `chainId`) | Ninguna | Nuevo |
| POST | `/suppliers` | Directorio | Operador | Token de administración | Nuevo |
| POST, GET | `/importers`, `/importers/{safe}` **[PROPUESTA]** | Directorio | Operador | Token de administración | Nuevo: registra quién representa a la Safe del importador |
| POST | `/shipments` | Atestaciones | Naviera | Firma de la `ShipmentAttestation` | Nuevo |
| POST | `/orders/{orderId}/approve-balance` | Firmas de cierre | Importador | Firma del importador, EOA o ERC-1271 | Nuevo |
| POST | `/orders/{orderId}/cancel-signature` | Firmas de cierre | Las partes | Firma sobre `cancelNonceOf` | Nuevo |
| POST | `/disputes/{orderId}/resolution` | Firmas de cierre | Árbitro | Firma de la `DisputeResolution` | Nuevo |
| POST | `/trade/uploads` | Carga de documentos | Las partes de la orden | Firma `DocumentUpload` | Decidir |
| POST | `/trade/documents` | Carga de documentos | Las partes de la orden | Firma `DocumentUpload` | Cambia |
| POST | `/trade/proforma` | Proforma | Importador registrado | Firma `ProformaUpload` | Existe |
| POST | `/trade/insights` **[PROPUESTA]** | Análisis de compras | Importador registrado | Firma `InsightsRequest` sobre el hash de las métricas | Nuevo: el modelo ve solo métricas agregadas que la app calculó y firmó, hasta 10 al día por importador; su respuesta es un consejo y no decide nada |
| POST | `/inbound` | Correo | Reenviador | Bearer `INGEST_WEBHOOK_TOKEN` | Decidir |
| GET, PUT | `/admin/settings` | Ajustes de ingesta | Operador | Bearer `INGEST_ADMIN_TOKEN` y `x-admin-actor` | Existe |
| POST | `/notices`, `/ingest/outcomes` | Envío de avisos | Agente, monitor e ingesta | Bearer; pasan a una cola interna | Cambia |

Notas:

* **La naviera entrega datos, no un archivo.** `/shipments` recibe una firma sobre cinco campos (orden, hash del BL, fecha *on board*, puerto y hash del paquete) y cabe en una petición normal. Los archivos del BL y la factura los sube el exportador ([paso 4](../flujo/paso-4-embarque.md)).
* **Carga por URL prefirmada.** La API acepta hasta 10 MB por petición y una Lambda hasta 6 MB, y el base64 agranda un archivo un tercio. Por eso `/trade/uploads` revisa la firma y las reglas, y entrega una URL temporal de S3 para subir el archivo directo. Pasar a esto y a lectura asíncrona cambia el contrato de [carga de documentos](../interfaces/carga-de-documentos.md) y de [lectura de la proforma](../interfaces/lectura-de-proforma.md): lo decide el Área 3 con el Área 4.
* **Solo las partes leen una orden.** La Lambda recupera la dirección que firmó la petición y la compara con `importer` o `exporter`. Si la tabla y la cadena no coinciden, vale la cadena.
* **No hay ruta de entrada desde Telegram** ([el bot solo envía](despliegue-aws.md)).
* **El registro de la empresa no tiene ruta.** Hoy el RUT, la razón social y los datos del representante no salen del teléfono (`app/src/data/onboarding.ts`). Una ruta `POST /companies` cambiaría esa decisión y la de [datos personales](datos-personales.md).

# Datos

| Dato | Servicio | Clave | Contenido | Reemplaza a |
| --- | --- | --- | --- | --- |
| Propuestas | DynamoDB | `orderId`, índice por parte | `po`, `terms`, propuesta original, firmas, estado; Stream al quedar firmada | Archivo en el teléfono |
| Órdenes | DynamoDB | `orderId`, índice por Safe | Orden firmada, términos, etiqueta, quién sube documentos, cuenta de cobro, atestación, extracciones, firmas de cierre, estado indexado | `registry.json`, `order.json`, `shipment.json`, `documents.json`, `INGEST_ORDERS_FILE` |
| Registro de partes | DynamoDB | Dirección | `taxId`, cuenta del bot, historial de montos por exportador | `registry.json` |
| Estado del agente | DynamoDB | Safe o cursor | Cursores, candado, nonce, avisos enviados con TTL, marca de pausa | Memoria del proceso |
| Tablas de ingesta | DynamoDB | `messageHash`, `invoiceKey`, alias, `orderId` | Correos vistos, facturas, solicitudes de cambio, cargas, BL únicos, lecturas de proforma y contadores diarios | SQLite (`ingest/src/store.ts`) |
| Ajustes y auditoría | DynamoDB | Clave fija y fecha | Proveedor y modelo del LLM, DMARC; cada cambio con quién lo hizo | `INGEST_SETTINGS_FILE` y el log |
| Registro de transferencias | DynamoDB | Fecha | Envíos de datos personales redactados al LLM | Memoria de `privacy-kit-cl` |
| Directorio del bot | DynamoDB | Cuenta y chat | Chats por rol, etiquetas de orden, avisos vistos con TTL, tope por hora, retenciones | `BOT_RECIPIENTS_FILE`, `BOT_ORDERS_FILE` y memoria |
| Documentos | S3 | `orderId/fileHash` | Archivos originales y correos crudos, cifrados y con versionado | No se guardaban |
| Evidencia de PDR | S3 con Object Lock | `pdrHash` | Entradas de cada decisión; se escribe antes de enviar | `evidence/pdr/` |
| Configuración | Systems Manager | `/keel/84532/*` | Despliegue, direcciones, `chainId`, URL de RPC y parámetros de política | `contracts/deployments/84532.json` y `KEEL_*` |

Reglas de datos:

* **La cadena es la fuente de verdad del estado.** Las tablas guardan lo que la cadena no tiene: la orden firmada con sus términos, las extracciones y los avisos. Dónde viven la orden y sus términos es la [decisión abierta 15](../decisiones/abiertas.md), y DynamoDB es la propuesta.
* **Los límites de ingesta se aplican con escrituras condicionales o transacciones**, no con lecturas previas: 20 correos por dominio al día, 10 cargas por orden y día, 20 proformas por importador, una solicitud de cambio pendiente por alias y 7 días de espera. SQLite lo hacía con `INSERT OR IGNORE` e índices únicos.
* **La evidencia no es pública en producción** ([verificador](verificador.md)).
