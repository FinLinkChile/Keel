---
type: Arquitectura
title: "Despliegue en AWS"
description: "Cómo se propone correr Keel en AWS sin servidores propios y por dónde entran las peticiones a la API: HTTP API con throttling ahora, REST API con WAF en producción."
tags: [aws, serverless, despliegue, api, waf, throttling]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T20:00:00Z }
---

**[PROPUESTA]** del Área 2 (Darienn), 17 de octubre de 2026. Falta que el equipo la confirme.

Keel corre en una cuenta AWS con servicios administrados, sin servidores propios: Lambda, API Gateway, SQS, DynamoDB, S3, EventBridge Scheduler, KMS, Secrets Manager, Systems Manager y CloudWatch. La red se abstrae como una URL de RPC ([stack](stack.md)). El diagrama interactivo con cada función, ruta, tabla, cola y llave está en el artifact [Keel en AWS](https://claude.ai/artifact/Vt92pMCFZFGcJUhnCKwYXY): la página 1 muestra el flujo simple y la página 2 la arquitectura ampliada.

## Entrada a la API

| Etapa | Servicio | Protección contra inundaciones |
| --- | --- | --- |
| Ahora (demo y pruebas) | API Gateway **HTTP API** | Throttling por stage y por ruta (tasa y ráfaga), más los límites que ya aplican ingesta y las Lambdas |
| Producción | API Gateway **REST API** con **AWS WAF** | Regla de tasa por IP, límite de tamaño del cuerpo y reglas administradas, aplicadas antes de invocar una Lambda |

Por qué:

* Los límites actuales (20 correos por dominio al día, 10 cargas por orden, 20 proformas por importador) se aplican dentro de la Lambda. Rechazar una petición ya cuesta una invocación, la verificación de la firma y una lectura de DynamoDB. WAF corta el exceso antes de llegar a la función.
* AWS WAF no se puede asociar a una HTTP API de API Gateway; sí a una REST API. Por eso producción pasa a REST API.
* El throttling de la HTTP API es un tope por ruta, no por IP: un atacante puede consumir el cupo de todos los usuarios. Se acepta para la demo y las pruebas.
* WAF protege la disponibilidad y el costo, no los fondos. Sin una firma válida nada se ejecuta y los contratos revierten igual ([amenazas](../flujo/amenazas.md)).

Reglas para las dos etapas:

* No se bloquea por país: el exportador opera desde China.
* Los topes se fijan por ruta. `POST /trade/proforma` llama al LLM y lleva el tope más bajo. Los valores de tasa y ráfaga están **[ABIERTO]**.
* Pasar de HTTP API a REST API no cambia las rutas ni la autenticación: cada ruta sigue exigiendo su firma EIP-712 o su token.
* La REST API cobra más por petición que la HTTP API, y WAF suma un cobro fijo mensual por reglas más uno por petición.
