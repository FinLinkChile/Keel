---
type: Arquitectura
title: "Llaves y secretos en AWS"
description: "Qué llaves de Keel pasan a KMS, cuáles nunca entran a AWS, qué secretos van en Secrets Manager y qué hace falta para firmar desde KMS."
tags: [aws, kms, llaves, secretos, custodia, iam]
modo: trade
status: draft
generated: { by: claude-code/claude-sonnet-5-5, at: 2026-10-18T15:00:00Z }
---

**[PROPUESTA]** del Área 2 (Darienn), 18 de octubre de 2026. Complementa [custodia y rotación de llaves](custodia-de-llaves.md), que sigue siendo la referencia de qué llave puede qué cosa. Aquí solo se dice dónde vive cada una al correr en AWS. Las direcciones del despliegue están en `contracts/deployments/84532.json`.

# En KMS

KMS guarda las llaves y firma con ellas sin que salgan. Se usa el tipo `ECC_SECG_P256K1`, la curva de Ethereum.

| Llave | Qué firma | La usa | Límite |
| --- | --- | --- | --- |
| Firmante de política | Solo `PolicyDecision` y `DocumentDecision` (EIP-712). En el prototipo también es el `documentVerifier` | Agente | No firma transacciones ni mensajes ni otros datos tipados |
| Relayer | Las transacciones del agente, y paga su gas | Agente | No es dueño ni miembro de ningún rol. Sin un PDR válido el gate y el escrow revierten |
| Guardian | Solo `emergencyPause` del gate | Monitor | Pausar, nunca mover fondos ni reanudar. Reanudar le toca a la Safe |

Reglas:

* **Una llave por rol, y un rol de IAM por función.** Hoy `engine/src/keys.ts` comprueba que dos roles no usen la misma llave. En AWS esa separación se hace cumplir en IAM: el agente no puede usar la llave del guardian, y el extractor no alcanza KMS.
* **El monitor pausa con la llave del guardian.** El gate también acepta la pausa del cosignatario, que `custodia-de-llaves.md` describe como automático en el servidor. Es otra opción, y la elección es del Área 1 y del Área 2.
* **Si una llave de servidor se roba, el daño queda acotado**: el relayer solo gasta gas, el firmante de política necesita un gate que acepte sus decisiones, y el guardian solo pausa.

# Nunca en AWS

| Llave | Por qué |
| --- | --- |
| Dueños de la Safe | La llave del dueño nunca vive en un servidor ni en una variable de entorno. Firman los cambios por Delay, `raiseDispute` y `unpause`. El despliegue de demo tiene dos dueños con umbral 1, un riesgo declarado |
| Cosignatario humano | Aprueba lo que supera el tope del agente |
| Naviera | Firma la atestación con su propia llave: un tercero |
| Árbitro | Firma la resolución de la disputa: un tercero |
| Deployer | Solo despliega contratos y no tiene permisos sobre los ya desplegados |

En la demo la naviera y el árbitro son llaves de prueba. En producción son de terceros y quedan fuera de AWS.

# Qué hace falta para firmar desde KMS

* **Un firmante para viem respaldado por KMS.** Para el PDR basta `signTypedData` (el motor pide `Pick<LocalAccount, "address" | "signTypedData">` en `engine/src/pdr.ts`). Para el relayer y el guardian hace falta además `signTransaction`, porque el agente envía con `walletClient.sendTransaction`.
* **La firma tiene que salir normalizada**: componente `s` bajo (*low-s*) y `v` igual a 27 o 28. El motor recupera la dirección tras firmar y la compara con la esperada, y una firma sin normalizar falla esa comprobación.
* **Un solo escritor del nonce.** El nonce es del relayer, no de la Safe. Ver [recorrido de una orden](aws-recorrido-de-una-orden.md).

# En Secrets Manager

Credenciales que no mueven fondos. Cada función lee solo las suyas.

| Secreto | Lo usa |
| --- | --- |
| Clave del proveedor de RPC | Agente, monitor e indexador |
| `TELEGRAM_BOT_TOKEN` | Envío de avisos |
| `INGEST_WEBHOOK_TOKEN`, si se mantiene el reenviador de correo | Correo |
| `INGEST_ADMIN_TOKEN` | Ajustes de ingesta |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` y `LLM_COMPAT_API_KEY` | Extractor y proforma |

Reglas heredadas de ingesta: los tokens miden al menos 32 caracteres y son distintos entre sí; las URL base del LLM y las llaves nunca se aceptan por la API de administración, solo vienen del entorno y de Secrets Manager. Un secreto filtrado de este grupo no da acceso a fondos.
