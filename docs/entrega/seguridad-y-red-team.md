---
type: Entrega
title: "Informe de seguridad y métricas del red team"
description: "Qué lleva el informe de seguridad (30% del puntaje), los riesgos que se declaran y las métricas que mide la batería de red team."
tags: [informe-de-seguridad, red-team, metricas, riesgos]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

El informe de seguridad vale el 30% del puntaje. Su matriz de amenazas, con control y riesgo residual, es la de [amenazas](../flujo/amenazas.md), más las de [Keel Personal](../personal/amenazas.md).

# Riesgos declarados

Riesgos declarados con honestidad: el contrato de escrow es código propio sin auditoría; la naviera del prototipo es una llave de prueba; el registro de partes lo administra Keel; el token de pago tiene riesgo de emisor; en una red cerrada la verificación pública depende de quién tenga acceso a ella; la bitácora prueba lo que el sistema registró, no que nada se haya escapado.

# Métricas del red team

Batería de 30 a 50 escenarios documentados: cambio de cuenta, BL fabricado, BL repetido, fecha *on board* alterada, monto de factura alterado, injection en documentos, urgencia y falsa autoridad, llaves robadas, intentos de retiro fuera de la máquina de estados.

- Tasa de bloqueo de ataques.
- Tasa de falsos positivos sobre documentos legítimos.
- Porcentaje de órdenes completadas sin intervención humana más allá de las firmas.
- Latencia de decisión.
- Capa que detuvo cada ataque.

Resultados publicados en el repositorio como red team abierto.

El contenido del informe es la tarea T5.3 y la batería la T5.4 del [Área 5](../trabajo/area-5-redteam-evidencia.md).
