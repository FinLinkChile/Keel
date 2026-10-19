---
type: Entrega
title: "Esquema del deck de 10 minutos"
description: "Historia del deck en 13 slides (unos 7 minutos y 25 segundos), qué criterio de puntaje cubre cada una, dónde está el deck animado en inglés y en español, qué se corrigió al revisar el guion y qué falta reemplazar antes de presentar."
tags: [deck, presentacion, guion, puntaje, t5-7]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-19T03:00:00Z }
---

**[PROPUESTA]** para la tarea T5.7 ([Área 5](../trabajo/area-5-redteam-evidencia.md)). Borrador de trabajo: el equipo lo confirma.

# Dónde está

El deck es una página HTML animada con anime.js, en [`deck/`](../../deck/README.md): `keel-deck-en.html` (para el jurado) y `keel-deck-es.html` (para ensayar). Funciona sin internet. El guion completo de cada slide está en el propio deck (tecla N) y en `deck/assets/content-en.js` y `content-es.js`, que es donde se edita el texto.

Las pantallas del teléfono son capturas reales de la app (`app/`, con `EXPO_PUBLIC_DEMO_SEED=1`), en inglés. En la pantalla de firma se ocultó el aviso de desarrollo "This demo order was not created on this phone", que solo aparece con las órdenes de ejemplo.

# La historia

Un solo hilo: Camila, compradora de Andes Tech, importa USD 87.000 en componentes electrónicos de Lingnan, en Hong Kong, con un anticipo del 50% (USD 43.500) y el resto pendiente en el escrow. Las capturas de la app se tomaron con los datos de demo cambiados solo para el deck (electrónica en vez de alimentos); `app/src/data/mock.ts` no cambió. Cada slide responde la pregunta que deja la anterior, para que no se sientan cortes.

| # | Slide | Pregunta que responde | Criterio | Tiempo |
| --- | --- | --- | --- | --- |
| 1 | Pagos que esperan la prueba | Qué es Keel | Todos | 0:20 |
| 2 | ¿Quién paga primero? | Cuál es el problema | Task completion | 0:45 |
| 3 | Conozcan Keel | Qué construimos | Innovation | 0:30 |
| 4 | Firmar | Cómo se fija a quién se paga | Task completion | 0:40 |
| 5 | Bloquear y anticipo | Cómo sabe el proveedor que el dinero existe | Task completion | 0:35 |
| 6 | Probar el embarque | Qué libera el saldo | Task completion | 0:45 |
| 7 | Reembolso | Qué pasa si no embarca | Task completion | 0:25 |
| 8 | ¿Y si engañan a la IA? | Por qué es seguro | Security | 1:05 |
| 9 | El agente como analista | Qué más hace el agente | Innovation | 0:20 |
| 10 | En la cadena | Cómo se verifica | Bonus on-chain | 0:25 |
| 11 | Modelo de negocio | Cómo gana dinero | Innovation | 0:40 |
| 12 | MVP honesto | Qué falta y qué sigue | Security, Innovation | 0:35 |
| 13 | Cierre | Vuelve a Camila | Todos | 0:20 |
| | **Total** | | | **7:25** |

El guion en inglés tiene unas 680 palabras: a 90 palabras por minuto son unos 7 minutos y medio, con margen bajo los 8.

# Qué se corrigió al revisar el guion anterior

| Antes | Problema | Ahora |
| --- | --- | --- |
| "When the carrier signs the shipment proof, the balance is released" | Incompleto: el saldo necesita la firma de la naviera **y** la del verificador de documentos (o la aprobación del importador) ([paso 5](../flujo/paso-5-saldo.md)) | "Two independent signatures release the money" |
| "The only LLM has no tools" | Con el analista hay un segundo modelo (propuesta) | "The AI only reads", hablando del extractor; el analista tiene su slide |
| "Nobody has to trust anybody" | Sobreafirmación: se confía en la naviera y el árbitro | "Anyone can trigger the refund, so she does not depend on anyone" ([paso 6](../flujo/paso-6-reembolso.md)) |
| "The money goes back" sin matiz | Solo vuelve el saldo; el anticipo queda con el exportador | Nota para responder si preguntan |
| "Every step has a transaction hash" | Subir documentos no es una transacción | "Every payment, block and revert leaves a hash" |
| "Closed network" | La red de la competencia es Base Sepolia ([alcance](../flujo/alcance.md)) | "Base Sepolia, a public test network" |
| Chile y China como alcance | Es el caso del MVP | Slide 12: cualquier empresa de cualquier país |
| Banco socio como hecho | Es propuesta, sin acuerdo con WeBank | Sello "Proposal · not built" en la slide 11 |

# Antes de presentar

* Reemplazar todo lo que aparece en amarillo con subrayado punteado: nombre del equipo, `[N]` órdenes, `[M]` ataques, el escenario y el hash del revert de la slide 8, los enlaces a los hashes de la slide 10 y el repositorio. El "0 fondos perdidos" también queda marcado hasta que el red team lo respalde.
* Confirmar con el equipo las marcas [PROPUESTA]: el analista (slide 9; si no se confirma, se salta), el MVP por país y el banco socio.
* Ensayar con el cronómetro del deck (tecla T, se pone rojo a los 8 minutos).
* Keel Personal no aparece, como pide la [decisión abierta 14](../decisiones/abiertas.md).
* Plazo de entrega: martes 20 de octubre, 12:59 hora de Chile ([entregables](entregables.md)).

# Preguntas probables del jurado

* *Is the bank partner real?* No agreement yet. It is our proposal and a next step.
* *Is it legal to invest the locked funds?* It needs a legal opinion and a bank partner. We do not claim it is legal today.
* *What if the carrier key is stolen?* Today it is a test key, a declared risk. In the pilot a real carrier or freight forwarder signs.
* *What if the AI is wrong?* The AI only reads. The payment account comes from the signed order, and the contract only releases with valid signatures.
* *What happens to the advance if the supplier never ships?* It stays with the supplier; only the balance returns. The advance percentage is agreed in the signed order.
* *Is the contract audited?* No. It is declared as a known risk.
