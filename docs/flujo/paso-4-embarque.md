---
type: Paso del flujo
title: "Paso 4: embarque y documentos"
description: "La naviera firma la atestación de embarque y el exportador sube BL y factura. Por qué la firma debe venir de un tercero y qué no hace la IA."
tags: [paso-4, embarque, atestacion, naviera, bl]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

El exportador embarca. Ocurren dos cosas distintas:

1. **La naviera (o el agente de carga) firma una atestación de embarque** con EIP-712: orden, hash del número de BL, fecha *on board*, puerto de carga y hash del paquete de documentos. La firma tiene que venir de un tercero: si la firmara el exportador, estaría certificando a su favor.
2. **El exportador sube el BL (o la guía aérea) y la factura.** El agente los lee para mostrarlos al importador y para que el motor los compare con la orden.

Cómo se obtiene la firma de la naviera:

| Etapa | Fuente |
| --- | --- |
| Prototipo | Una llave de prueba que representa a la naviera |
| Intermedio | Un agente de carga registrado firma al recibir la carga |
| Ideal | Plataforma de BL electrónico, donde la naviera emite con firma digital |

Para la etapa ideal ya existen estándares de la industria y leyes que reconocen documentos electrónicos transferibles. **[DISEÑO]**

# Qué no hace la IA aquí

La IA puede leer el PDF del BL para mostrar los datos al importador o para que el motor compare con la orden, pero **nunca reemplaza la firma de la naviera**. Una firma escaneada en un PDF es una imagen y no prueba nada.

El struct de la atestación está en [datos firmados e interfaz](datos-firmados-e-interfaz.md). Cómo se leen los documentos está en [pipeline de documentos](../arquitectura/pipeline-de-documentos.md).
