---
type: Arquitectura
title: "El analista: análisis de compras con un modelo, fuera del flujo de pago"
description: "Qué recibe el modelo que analiza las compras de la empresa, qué devuelve, cómo se valida, por qué no puede ser manipulado por un documento y qué no puede hacer."
tags: [analista, llm, analisis, agente, d2, nivel-0]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T09:00:00Z }
---

**[PROPUESTA]** del Área 3 (Daniela), con el visto bueno del mentor ("es algo esperado; lo rápido es una integración típica para el prototipo y, a futuro, modelos predictivos entrenados"). Amplía [D2](../decisiones/transversales.md): **el equipo tiene que confirmarla.**

# Qué es

Un segundo modelo, de **nivel 0** ([niveles de permiso](niveles-de-permiso.md)): lee y aconseja, no firma, no decide y no mueve dinero. Está **fuera del flujo de pago**: el extractor en cuarentena, el validador, el motor, el PDR y el contrato siguen como dice D2. En la app es la tarjeta "What the agent sees" de la pestaña Agent.

# Qué recibe

Solo métricas calculadas en el teléfono a partir de las órdenes de la empresa (`app/src/data/analysisInput.ts`): gasto por mes y por periodo, participación de cada proveedor y producto, cambios de gasto y de precio por unidad, ritmo de compra y próxima compra esperada, anticipos y saldos comprometidos, cumplimiento y negociación, más el rubro y el tramo de ventas de la empresa.

* Los proveedores van como `S1`, `S2`; los productos, como código HS. **Ningún nombre, descripción, dirección ni texto de un documento** llega al modelo. La app vuelve a poner los nombres al mostrar el análisis.
* Ingesta valida las métricas con un esquema estricto: tipos cerrados, números, ids y periodos con formato fijo. Una métrica con texto se rechaza antes de llegar al modelo.

Por eso **un documento no puede manipular al analista**: en su entrada no hay nada que alguien haya escrito o impreso.

# Qué devuelve y cómo se valida

Hasta 5 hallazgos, cada uno con tipo, gravedad, las métricas que cita, un título y una recomendación cortos (`ingest/src/trade/insights.ts`). Un hallazgo se descarta si:

* cita una métrica que no se envió;
* escribe un número que no es el valor (redondeado o en miles) de una métrica que cita;
* contiene una dirección, una cuenta, un enlace o un correo.

La app vuelve a comprobar la forma y las métricas citadas antes de mostrarlo.

# Ruta

`POST /trade/insights`, firmada con `InsightsRequest(bytes32 inputHash,uint64 issuedAt)` en el dominio de ingesta: la firma cubre las métricas exactas enviadas. Solo para importadores registrados, 10 análisis por día. Ingesta no guarda las métricas ni el análisis, solo la hora de cada pedido para el límite. El envío al proveedor queda registrado con la finalidad `analisis_compras` (Ley 21.719).

# Trabajo futuro

Modelos predictivos entrenados con datos propios (próxima compra, flujo de caja, riesgo de cada proveedor), cuando haya meses de órdenes reales. Comparación con otras empresas, solo con agregados ([datos personales](datos-personales.md), PR #81).
