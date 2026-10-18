---
type: Arquitectura
title: "Despliegue en AWS"
description: "Cómo se propone correr Keel en AWS sin servidores propios: principios, mapa de los conceptos de la arquitectura y por dónde entran las peticiones a la API (HTTP API con throttling ahora, REST API con WAF en producción)."
tags: [aws, serverless, despliegue, api, waf, throttling]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T22:00:00Z }
---

**[PROPUESTA]** del Área 2 (Darienn), 17 de octubre de 2026. Falta que el equipo la confirme.

Keel corre en una cuenta AWS con servicios administrados, sin servidores propios: Lambda, API Gateway, SQS, DynamoDB, S3, EventBridge Scheduler, KMS, Secrets Manager, Systems Manager y CloudWatch. La red se abstrae como una URL de RPC ([stack](stack.md)). El diagrama interactivo con cada función, ruta, tabla, cola y llave está en el artifact [Keel en AWS](https://claude.ai/artifact/Vt92pMCFZFGcJUhnCKwYXY): la página 1 muestra el flujo simple y la página 2 la arquitectura ampliada.

## Principios del despliegue

1. **La red es una URL de RPC.** Todo lo que habla con la cadena la recibe por configuración, hoy la de Base Sepolia (84532). Cambiar de red es cambiar la URL, el `chainId` y `contracts/deployments/<chainId>.json`.
2. **El motor no cambia.** Es una librería pura que las Lambdas del agente y del monitor importan, sin red ni LLM propios. Lo que cambia es dónde corre y dónde guarda su estado.
3. **La cadena es la fuente de verdad del estado.** Las tablas guardan lo que la cadena no tiene: la orden firmada, las extracciones y los avisos.
4. **Las llaves de servidor van en KMS y la del dueño nunca entra a AWS.** Una llave por rol y un rol de IAM por función. En la rama `AWS`, mientras el Área 1 no registre las direcciones de KMS, la demo toma las llaves actuales de Systems Manager (ver la sección de implementación).
5. **Cada capa asume que la anterior pudo fallar.** Sin un PDR válido el gate y el escrow revierten, y cada decisión deja evidencia con su hash antes de enviarse.

## Dónde está cada cosa

| Concepto | Qué responde |
| --- | --- |
| [Componentes](aws-componentes.md) | Qué servicio cumple cada función, qué es hoy en el repo y su estado |
| [API y datos](aws-api-y-datos.md) | Las rutas, quién las llama y cómo se autentican; las tablas y buckets |
| [Llaves y secretos](aws-llaves-y-secretos.md) | Qué va en KMS, qué nunca entra a AWS y qué va en Secrets Manager |
| [Recorrido de una orden](aws-recorrido-de-una-orden.md) | Qué piezas intervienen en cada paso y cómo trabaja el agente por vueltas |
| [Pendientes](aws-pendientes.md) | Qué falta construir por área, decisiones abiertas y riesgos |

## Entrada a la API

| Etapa | Servicio | Protección contra inundaciones |
| --- | --- | --- |
| Ahora (demo y pruebas) | API Gateway **HTTP API** | Throttling por stage y por ruta (tasa y ráfaga), más los límites que ya aplican ingesta y las Lambdas |
| Producción | API Gateway **REST API** con **AWS WAF** y **CloudFront** delante | Regla de tasa por IP, límite de tamaño del cuerpo y reglas administradas, aplicadas antes de invocar una Lambda |

Pasar a REST API con WAF y CloudFront delante es una de las promesas de seguridad a futuro del MVP ([MVP y seguridad por país](../flujo/mvp-y-seguridad-por-pais.md)).

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

## El bot solo envía

**[PROPUESTA]** En AWS el bot de Telegram solo envía avisos: el sistema no recibe mensajes desde Telegram. No hay webhook, ni ruta `/telegram`, ni `secret_token`, y la Lambda de avisos solo llama a `sendMessage`. Cualquier mensaje que alguien escriba al bot se ignora.

* Hoy el bot atiende `/start` y `/status` con textos fijos por polling (`bot/src/main.ts`, `bot/src/adapters/telegram/commands.ts`). Esos dos comandos y el polling se retiran.
* Quien opera el sistema lo hace desde la app, donde firma la billetera. El bot nunca firma ni decide: sus botones abren la app ([principios](../flujo/principios.md)).
* Afecta al Área 4, que es dueña del bot y debe confirmarlo. Alta de chats y tope por chat siguen como en [avisos al bot](../interfaces/avisos-al-bot.md).

## Implementación en la rama `AWS` **[PROPUESTA]**

Código del 18 de octubre (Área 5 con Claude, sobre esta propuesta del Área 2). Sin desplegar: todo está probado con DynamoDB, S3, SQS y una cadena simulados, nunca contra una cuenta real.

| Pieza | Dónde |
| --- | --- |
| Infraestructura (20 funciones, 30 rutas, 6 tablas, 3 llaves KMS, colas, buckets, alarmas) | `infra/terraform/` |
| Funciones | `aws/src/handlers/`, empaquetadas con `npm run build -w aws` en `infra/terraform/dist/` |
| Llaves (KMS o SSM por rol), autenticación de peticiones, configuración, avisos, candado | `aws/src/` |
| Formas de los items de DynamoDB | `aws/src/tables.ts` |
| Ganchos del motor para correr fuera del CLI (evidencia antes de enviar, `open`, firmas de cierre, cursor del monitor) | `engine/src/agent/`, `engine/src/monitor/` |

Diferencias con esta propuesta, y por qué:

* **Secretos en Systems Manager, no en Secrets Manager.** SecureString no tiene costo en la cuenta gratuita; Secrets Manager cobra unos 0,40 USD por secreto al mes. Cada función lee solo los suyos (`infra/terraform/locals.tf`). Terraform no los crea: un parámetro gestionado por Terraform guarda su valor descifrado en el estado, así que se crean a mano (`infra/terraform/README.md`).
* **Llaves por rol en KMS o en SSM.** El código acepta las dos (`KEY_SOURCE_*`). La demo usa SSM porque las direcciones registradas en la cadena son las de las llaves actuales; pasar a KMS exige que el Área 1 registre antes las direcciones de KMS (`setPolicySigner`, `setGuardian`, relayer).
* **El bot solo envía, y los chats los registra el operador** con `PUT /bot/recipients` (token y auditoría), sin editar archivos. Sin webhook ni ruta desde Telegram.
* **Un candado por relayer en DynamoDB** además de la cola por Safe: cubre el choque de nonce si un relayer sirve a varias Safes, y no depende de la concurrencia reservada, que una cuenta nueva puede no permitir.
* **El indexador lee solo los eventos de `TradeEscrow`.** Los de `FundingGate` y `PDRVerifier` quedan pendientes.
* **La autenticación de peticiones** sigue el patrón de la carga de documentos: [autenticación de la API](../interfaces/autenticacion-api.md).
