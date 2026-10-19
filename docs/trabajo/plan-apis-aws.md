---
type: Plan de trabajo
title: "Plan: APIs pendientes de Keel en AWS"
description: "Qué falta construir en la API de AWS y en la app para que muestren todo el recorrido de una orden, dividido en partes independientes, con dónde va cada pieza, el contrato de cada ruta, las pruebas y el orden para ejecutarlo con agentes."
tags: [aws, api, plan, app, modularidad, agentes]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T23:30:00Z }
---

**[PROPUESTA]** del Área 5 (Benjamín, con Claude), para ejecutar después con agentes sobre la rama `AWS`. Parte de lo que ya está construido y desplegado ([despliegue en AWS](../arquitectura/despliegue-aws.md)). Ninguna parte cambia contratos, cierra una [decisión abierta](../decisiones/abiertas.md) ni rompe un principio de `CLAUDE.md`. La parte D toca una decisión de producto y queda para decidir.

# Qué falta

| Parte | Qué resuelve | Rutas | Tamaño | Depende de |
| --- | --- | --- | --- | --- |
| 0 | Base modular: un solo simulador de DynamoDB, lógica fuera de los handlers, paquetes más livianos | Ninguna | M | Nada |
| A | La app no ve el resultado de la lectura de cada documento (hoy solo queda "Uploaded" y el resultado llega por Telegram) | `GET /orders/{orderId}/documents` | M | 0.1 (recomendado) |
| B | La línea de tiempo no tiene fechas de depósito, embarque ni cierre | Amplía `GET /orders/{orderId}` y `GET /orders` | M | 0.2 |
| C | La cotización de la proforma se pierde al cerrar la app | Amplía `POST /proposals` y la vista de la propuesta | S | Nada |
| D | Abrir una disputa desde la app (`raiseDispute`) | Ninguna en la API | L | Decisión de producto |
| E | Nombres de las partes y avisos de la naviera y el árbitro en "Necesita tu acción" | `GET /parties`, amplía `GET /needs-you` | S | Nada |

# Reglas de modularidad para todas las partes

Cada agente las sigue. Son las que dejó la revisión de la rama (ver `docs/log.md`, 18 de octubre).

1. **Un dominio, una carpeta.** La lógica vive en `aws/src/<dominio>/` como funciones puras con pruebas: `orders`, `ingest`, `agent`, `bot`. Un handler de `aws/src/handlers/` solo arma la ruta con `api()` de `aws/src/http.ts`, lee el entorno y llama al dominio; no lleva reglas.
2. **Un dominio no importa a otro.** Si las órdenes necesitan leer algo de ingesta, ingesta expone una función de solo lectura en `aws/src/ingest/reads.ts` y órdenes la recibe como puerto (una interfaz en `aws/src/orders/ports.ts`), para que se pruebe con un doble.
3. **Las formas de los datos en un solo lugar.** Cada campo nuevo de un ítem de DynamoDB va en `aws/src/tables.ts`, opcional y con un comentario de quién lo escribe. Cada cuerpo o respuesta nueva se valida con zod estricto en el `codec.ts` del dominio.
4. **La app no conoce AWS.** Las llamadas van en `app/src/data/api.ts` (cliente tipado) y la traducción a los tipos de la app en `app/src/data/withApi.ts`. Sin `EXPO_PUBLIC_API_URL`, la app se comporta como antes.
5. **Infraestructura junto al código.** Una ruta nueva se agrega en `infra/terraform/locals.tf` (`routes`) y, si la función lee otra tabla, su rol en `role_statements` con el mínimo permiso. `terraform validate` tiene que pasar.
6. **Cada cambio con prueba y con documento.** Una prueba que falla sin el cambio. Si cambia un contrato que usa otra área, se actualiza el concepto en `docs/` y se agrega una línea en `docs/log.md`.
7. **Comentarios en inglés**, con la densidad del código que los rodea. Textos de pantalla en inglés y su traducción en `app/src/i18n/es.ts`.

# Parte 0: base modular

Cinco tareas independientes entre sí: cada una puede ir en un agente distinto. Ninguna cambia comportamiento; las pruebas existentes deben seguir pasando igual.

* **0.1 Un solo simulador de DynamoDB.** Hoy hay tres: `aws/src/testing/fakeDynamo.ts` (estricto), `aws/src/orders/fakeDdb.ts` (con índices) y el de `aws/src/testing/fakes.ts`. Extender el estricto con índices secundarios, `Scan` y `BatchGet`; migrar las pruebas de `orders`, `agent` y `bot` a él; borrar los otros dos; mover `aws/src/orders/testkit.ts` a `aws/src/testing/`. Hecho: un solo archivo de simulador y todas las pruebas de `aws` verdes.
* **0.2 Lógica del indexador fuera del handler.** `RANK`, `advances` y `applyEvent` están en `aws/src/handlers/indexer.ts`. Moverlos a `aws/src/agent/mirror.ts` con sus pruebas; el handler solo programa la pasada. La parte B se apoya en esto.
* **0.3 Piezas repetidas en órdenes.** `Ctx` y `queryIndex` viven en `aws/src/orders/proposals.ts` y `closing.ts` importa `loadOrder` de `views.ts`. Mover lo compartido a `aws/src/orders/context.ts`; un solo ayudante de `BatchGet` con reintentos acotados en `aws/src/db.ts` (hoy hay tres copias, dos sin tope); una sola expresión de dirección en el `codec`.
* **0.4 Paquetes más livianos.** `@keel/ingest` exporta también el servidor local y SQLite, y eso mete pdfjs y `node:sqlite` en funciones que no los usan (`admin`, `digest`, `upload`, unos 6 MB cada una). Separar un punto de entrada local (`@keel/ingest/local` con `IngestStore` y el servidor) y que el barril principal exporte solo lo que corre en Lambda. Hecho: `npm run build -w aws` deja `admin`, `digest` y `upload` bajo 2 MB.
* **0.5 Pendientes menores de infraestructura.** Cambiar `hash_key` por `key_schema` en `infra/terraform/data.tf` (aviso de deprecación); un solo cliente de SQS (hoy en `aws/src/agent/clients.ts` y en `aws/src/notices.ts`). Hecho: `terraform plan` sin avisos.

# Parte A: estado de cada documento

**Para qué:** la persona que sube el BL o la factura ve si se leyó, si quedó retenido y por qué, sin depender de Telegram. Sirve al [paso 4](../flujo/paso-4-embarque.md).

**Contrato** (lo leen las partes de la orden, con petición firmada):

```
GET /orders/{orderId}/documents
200 { "documents": [ { "fileHash", "docType", "party": "importer"|"exporter", "receivedAt", "status": "pending"|"reading"|"ready"|"held"|"duplicate"|"quarantined", "reason"? } ] }
404 not_found   (orden desconocida o quien firma no es parte)
```

* `reason` es un código de ingesta (`extractor_failed`, `doc_type_mismatch`, `bl_used_by_other_order`…), nunca texto del documento ni de la extracción.
* No devuelve la extracción ni datos del documento: solo estado. Lo que el agente usa sigue en `OrderItem.documents`.

**Piezas:**

| Dónde | Qué |
| --- | --- |
| `aws/src/ingest/reads.ts` (nuevo) | `listOrderUploads(orderId)`: lee `upload#<orderId>` / `file#*` del repositorio de ingesta y traduce `readStatus` a `status` y `reason` |
| `aws/src/orders/ports.ts` (nuevo) | Interfaz `DocumentStatusReader`, la que recibe la vista |
| `aws/src/orders/views.ts` | `orderDocuments(orderId, signer, reader)`: revisa que quien firma sea parte y arma la respuesta |
| `aws/src/handlers/orders.ts` | La ruta, inyectando `listOrderUploads` |
| `infra/terraform/locals.tf` | Ruta nueva en `orders`; el rol `orders_read` lee la tabla de ingesta (`GetItem`, `Query`) y nada más |
| `app/src/data/api.ts`, `withApi.ts`, `types.ts` | `orderDocuments()`; `OrderDocument.status` suma `held` con su motivo; la orden muestra cada documento con su estado |
| `docs/interfaces/carga-de-documentos.md` | La ruta nueva, en la sección "En AWS" |

**Pruebas:** un extraño recibe 404; cada `readStatus` da el `status` esperado; la respuesta no trae campos de la extracción; la app traduce `held` con su motivo.

# Parte B: fechas de la línea de tiempo

**Para qué:** que la orden muestre cuándo se depositó, embarcó y cerró, como en la app local.

**Contrato:** la vista de una orden suma un campo opcional, sin romper a quien no lo lee:

```
"timeline": { "OPEN"?: { "at", "block", "tx" }, "ADVANCE_PAID"?: {...}, "SHIPPED"?: {...}, "DISPUTED"?: {...}, "SETTLED" | "REFUNDED" | "RESOLVED" | "CANCELLED"?: {...} }
```

`at` en segundos unix, la hora del bloque del evento.

**Piezas:**

| Dónde | Qué |
| --- | --- |
| `aws/src/agent/mirror.ts` (de la tarea 0.2) | Al aplicar un evento, guarda también `timeline[estado]` con la hora del bloque. La hora se pide una vez por bloque (caché dentro de la pasada) al puerto de cadena del motor |
| `aws/src/tables.ts` | `OrderItem.chain.timeline`, opcional, escrito solo por el indexador |
| `aws/src/orders/views.ts` | La vista expone `timeline` |
| `app/src/data/withApi.ts` | `advancePaidAt`, `shippedAt` y la fecha de cierre salen de `timeline`; `app/src/data/orderTimeline.ts` ya sabe mostrarlas |

**Pruebas:** un evento repetido no pisa la fecha ya guardada; un evento de un bloque anterior no la cambia; la app arma la línea de tiempo con las fechas del servidor.

# Parte C: cotización de la proforma

**Para qué:** conservar lo que pidió la proforma para compararlo con lo firmado (análisis de negociación de la app), entre teléfonos y sesiones.

**Contrato:** `POST /proposals` acepta `quote` opcional y la vista lo devuelve. Es información de apoyo: **no se firma, no entra al PDR ni al motor y nunca decide un pago**. Con un esquema estricto igual al tipo `Quote` de `app/src/data/types.ts` y un tope de tamaño.

**Piezas:** `CreateBody` en `aws/src/orders/proposals.ts` y su esquema en `codec.ts`; `ProposalItem.quote` en `aws/src/tables.ts`; `app/src/data/httpProposals.ts` lo envía y lo lee (hoy lo guarda solo en memoria).

**Pruebas:** una propuesta con y sin `quote`; un campo desconocido dentro de `quote` responde 400; la app conserva la cotización al recargar.

# Parte D: disputa desde la app (decidir antes de construir)

`raiseDispute(orderId)` exige que lo envíe una parte (`msg.sender`). El importador es una Safe y el exportador una billetera, y la app hoy no envía transacciones: solo firma. Ni el relayer ni la API pueden enviarlo por ellos, y está bien que así sea: abrir una disputa congela el saldo.

Opciones, para que el equipo decida:

* **Exportador:** la app envía la transacción con su billetera; necesita ETH para el gas y un cliente de RPC en la app.
* **Importador:** la app arma una transacción de la Safe, los dueños la firman y se envía por la Safe Transaction Service o por un dueño. Es lo más largo.
* **Seguir como hoy:** la app explica cómo hacerlo desde la Safe o la billetera.

Hasta que se decida, no se construye. Si se decide, se registra en `docs/decisiones/abiertas.md` y en [disputa y cancelación](../flujo/disputa-y-cancelacion.md).

# Parte E: nombres y terceros

* **`GET /parties`** (petición firmada): nombre y rol de las direcciones de las órdenes donde quien firma es parte, desde la tabla `parties`. La app deja de usar nombres de ejemplo (`base.partyByAddress`). Lógica en `aws/src/orders/directory.ts`.
* **"Necesita tu acción" de la naviera y el árbitro:** `atestar` cuando la orden está en `ADVANCE_PAID` y quien firma es la naviera de la orden; `resolver` en `DISPUTED` para el árbitro. Hoy no se listan porque no hay índice por naviera o árbitro: o se agrega un índice secundario a `orders` o se recorre con `Scan` filtrado, aceptable a esta escala y comentado como tal.

# Orden y reparto entre agentes

1. **Parte 0**, con hasta cinco agentes en paralelo, uno por tarea. Cada uno en su propio worktree desde `AWS`.
2. Después, **A, B, C y E en paralelo**, un agente por parte. Tocan dominios distintos, salvo tres archivos compartidos: `aws/src/tables.ts`, `app/src/data/api.ts` y `app/src/data/withApi.ts`. Cada agente agrega solo su bloque en ellos; el coordinador resuelve al integrar.
3. **D** solo si el equipo decide una opción.
4. Al final, integración: mergear las ramas en `AWS`, pruebas completas, empaquetar y `terraform plan`.

Instrucciones comunes para cada agente:

* Partir de la punta de `AWS` y confirmar `git log --oneline -1` antes de empezar; `npm ci`, y `git submodule update --init` si corre pruebas del motor.
* No hacer push; un commit por parte, con el mensaje terminado en la línea de coautoría que indique el coordinador.
* Informar: rama y commit, archivos, contrato exacto de cada ruta nueva, variables y permisos que pide a Terraform, resultado de las pruebas y lo que quedó sin hacer.

# Cómo se verifica

* `npx tsc --noEmit` en cada paquete; la app conserva solo los errores conocidos de rutas tipadas de Expo.
* `npx vitest run --exclude ".claude/**"` verde, salvo la prueba de permisos de archivo en Windows de `ingest/src/settings.test.ts`, que ya falla en `dev`.
* `npm run build -w aws` y cada función carga sola fuera del repositorio.
* En `infra/terraform`, `terraform validate` y `terraform plan` sin errores.
* Con lo desplegado: `npm run build -w aws`, `terraform apply`, y la prueba de punta a punta de la app contra la API.
