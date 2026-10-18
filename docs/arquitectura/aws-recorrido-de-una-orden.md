---
type: Arquitectura
title: "Recorrido de una orden en AWS"
description: "Qué piezas de AWS intervienen en cada paso del flujo de Keel Trade y cómo trabaja el agente por vueltas: cola por Safe, candado y nonce, evidencia antes de enviar, indexador y monitor."
tags: [aws, flujo, agente, sqs, nonce, indexador, monitor]
modo: trade
status: draft
generated: { by: claude-code/claude-sonnet-5-5, at: 2026-10-18T15:00:00Z }
---

**[PROPUESTA]** del Área 2 (Darienn), 18 de octubre de 2026. Los pasos son los de [flujo clave](../flujo/flujo-clave.md). Los componentes están en [componentes](aws-componentes.md) y las rutas en [API y datos](aws-api-y-datos.md).

# Un paso del flujo, una pieza de AWS

| Paso | Qué ocurre | Piezas de AWS |
| --- | --- | --- |
| 0. Negociación | La app sube la proforma y recibe campos tipados para prellenar la orden | API HTTP, Lambda de proforma y proveedor del LLM. Nunca devuelve la cuenta de cobro |
| 1. Firma de la orden | El importador crea la propuesta, el exportador la firma desde su teléfono y el importador da la firma final | API HTTP, Lambda de propuestas, DynamoDB. Al quedar firmada, el Stream dispara el alta de orden |
| 2. Depósito | El agente simula, firma el PDR y deposita por el FundingGate | Programador, reparto por Safe, vueltas por Safe, agente, KMS, evidencia en S3 y URL de RPC |
| 3. Anticipo | Sale en la misma transacción del depósito | Las mismas del paso 2 |
| 4. Embarque | La naviera entrega la atestación (datos firmados) y el exportador sube BL y factura (archivos) | Lambda de atestaciones; carga por URL prefirmada a S3, cola de lectura y extractor. En la vuelta siguiente, el agente presenta el embarque |
| 5. Saldo | El motor compara los documentos con la orden y la atestación; tras la ventana de disputa se libera, o el importador aprueba antes con su firma | Agente, KMS, evidencia en S3; la Lambda de firmas de cierre recibe `approveBalance` |
| 6. Reembolso | Si venció el plazo sin embarque, el saldo vuelve al importador | Agente, que vigila `shipmentDeadline` más `refundGrace` |
| Disputa y cancelación | La disputa la abre una parte desde su Safe; la resolución y la cancelación son firmas | Lambda de firmas de cierre y agente. `raiseDispute` no pasa por AWS |

En todos los pasos, el indexador mantiene el estado que lee la app y el bot avisa por la cola de avisos.

# El agente trabaja por vueltas

El agente **no recibe avisos**: cada minuto revisa el estado de sus órdenes en la cadena y da **como máximo un paso por orden** (`engine/src/agent/agent.ts`).

| Estado de la orden en la cadena | Paso de esa vuelta |
| --- | --- |
| Abierta | `fund` por el gate |
| Anticipo pagado | `submitShipment` si hay atestación, o `refundAfterDeadline` si venció el plazo |
| Embarcada | `releaseBalance` |

Por eso un mismo paso del flujo puede esperar hasta una vuelta, unos 60 segundos: entre que llegan los documentos y se envía `submitShipment` no hay ningún aviso. Que el extractor o el indexador encolen una vuelta de esa Safe apenas termine el trabajo es una mejora **[PROPUESTA]**, sin implementar.

El camino de una vuelta: Programador, Reparto por Safe, Vueltas por Safe y Agente. El mensaje de la cola es "despierta y revisa esta Safe", no una orden. Las órdenes viven en DynamoDB.

# Por qué una cola por Safe

SQS FIFO con `MessageGroupId` igual a la dirección de la Safe deja pasar una vuelta a la vez por Safe, y Safes distintas corren en paralelo. Hace falta porque en Lambda dos vueltas pueden traslaparse: una vuelta recorre las órdenes en serie y espera el recibo de cada transacción sin límite de tiempo, y puede tardar más de un minuto.

Sin ella:

* **Choque de nonce.** El agente envía con `sendTransaction` sin gestionar el nonce, y dos transacciones del mismo relayer con el mismo número no entran las dos.
* **Envíos duplicados.** Dos vueltas ven la orden en el mismo estado, simulan, pasan ambas y envían. Una revierte.
* **Avisos repetidos.** La lista de avisos ya enviados está en memoria y cada instancia de Lambda tiene la suya.

Los fondos no corren riesgo por esto: el contrato y la simulación impiden pagar dos veces, y el nonce de fondeo es `BigInt(orderHash)`, que el gate marca como usado. El daño sería transacciones fallidas, gas perdido y avisos duplicados.

# Candado y nonce

| | Candado | Nonce |
| --- | --- | --- |
| Qué es | Marca de "ocupado" que ponemos nosotros | Contador de transacciones de una llave |
| Quién lo exige | Nuestro diseño | La red |
| Qué evita | Dos vueltas trabajando a la vez con la misma Safe | Dos transacciones del relayer con el mismo número |
| Dónde vive | DynamoDB, con caducidad por si una vuelta muere | Se lee de la red y se guarda en DynamoDB |

La cola por Safe hace de candado, y con concurrencia reservada de 1 también. El **nonce es por llave y no por Safe**: si un mismo relayer sirve a varias Safes, vueltas de Safes distintas pueden chocar igual. Hace falta un gestor de nonce en DynamoDB o un relayer por Safe. Con una sola Safe, como en la demo, basta concurrencia reservada de 1 y la cola no es necesaria. Esto está **[ABIERTO]** para el Área 2.

# Evidencia antes de enviar

La evidencia de cada PDR se guarda en S3 **antes** de enviar la transacción. El monitor decide que un depósito o una decisión de documentos es desconocido cuando no existe el archivo de evidencia, así que escribir después dejaría una ventana en la que una transacción legítima parece sospechosa. Con Object Lock el archivo no se reescribe, y el hash en la cadena delataría un cambio. Ver [evidencia y bitácora](evidencia-y-bitacora.md).

# Indexador y monitor

* **Indexador.** Lee con `getLogs` los eventos de `TradeEscrow`, `FundingGate` y `PDRVerifier` por rangos de bloques desde `deployBlock`, y deja el estado de cada orden. Es de donde la app saca la etapa, porque la app no lee la cadena. Guarda su cursor de bloque: sin él, un reinicio salta eventos.
* **Monitor.** Retoma desde su cursor guardado, busca depósitos y decisiones de documentos sin evidencia de Keel, y cambios en cola o pausas. Ante un incidente simula y envía `emergencyPause` una sola vez, y avisa. Puede pausar, nunca mover fondos. Hoy el cursor y la marca de pausa viven en memoria y hay que persistirlos.
* Los proveedores de RPC limitan el rango de `getLogs`: sin `deployBlock` el agente parte de "earliest", así que el despliegue de `84532.json` (`deployBlock` 48233746) tiene que estar siempre disponible.

# Avisos

Agente, monitor, ingesta y el alta de orden publican en una cola SQS con cola de fallidos, y la Lambda de envío los manda a Telegram. Cada aviso lleva un id determinista para no repetirse, y la deduplicación, el tope por chat y las retenciones por documento pasan a DynamoDB. Hoy el POST sin reintento con timeout de 3 s pierde el aviso si el bot tarda.
