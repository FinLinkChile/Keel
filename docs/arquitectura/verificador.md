---
type: Arquitectura
title: "Verificador reproducible"
description: "Cómo `keel verify` comprueba una decisión del motor desde la transacción o desde el archivo de evidencia, cómo la ancla a los contratos desplegados, qué prueba y qué no."
tags: [verificador, pdr, evidencia, t2-9, reproducible, despliegue]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T18:45:00Z }
---

El [archivo del PDR](evidencia-y-bitacora.md) guarda también todo lo que la decisión usó (`replay`): la orden, el contexto leído en ese momento, las extracciones y la política con su versión de reglas. Con eso, `keel verify` (T2.9, `engine/src/verify.ts`) vuelve a correr las mismas reglas y compara cada hash.

# Dos modos

* `npm run keel -- verify <txHash> --rpc <url>` lee la transacción y la **ancla al despliegue**: solo cuenta un evento conocido emitido por el contrato oficial, y la firma tiene que ser de la llave que ese contrato aceptaba en ese bloque (abajo). Resultado: MATCH o MISMATCH.
* `npm run keel -- verify --pdr <pdrHash>` verifica solo el archivo, sin red. Resultado: **EVIDENCE ONLY** si el archivo es coherente, nunca MATCH: prueba que el archivo no fue alterado, no que la cadena lo aceptara. Sirve mientras la [decisión abierta 13](../decisiones/abiertas.md) no diga cómo verifica el jurado en una red cerrada.

Código de salida: 0 MATCH, 1 MISMATCH o sin evidencia, 2 error de uso o de lectura (también si se pasan a la vez un hash de transacción y `--pdr`), 3 EVIDENCE ONLY.

Los PDR anclados sin archivo de evidencia se listan como no verificados (un saldo liberado por la `BalanceApproval` del importador no tiene archivo). Si un evento conocido con el hash de un PDR lo emitió un contrato que no está en el despliegue y su archivo existe, el resultado es MISMATCH y dice qué contrato lo emitió.

# Cómo se ancla

Nada de lo que dice el archivo sobre quién firmó o dónde se acepta sin compararlo con la cadena:

| Comprobación | Contra qué |
| --- | --- |
| Contrato | Las direcciones oficiales de `contracts/deployments/<chainId>.json` (opción `--deployments`). Sin ese archivo no se ancla nada, y si su campo `chainId` no es el del nombre del archivo, el verificador se detiene con error |
| Evento | Solo `PaymentExecuted` del PDRGate, `FundingExecuted` del FundingGate o `BalanceReleased` del TradeEscrow, elegido por su tipo (`topic0`) y su emisor, con el hash del PDR en su campo (`pdrHash` o `authorizationDigest`) |
| Contrato del dominio | El `verifyingContract` firmado es el contrato oficial |
| Firmante (`signer on chain`) | Depósito y pago: `policySigner()` del gate en el bloque de la transacción. Saldo: el `documentVerifier` de la orden que guarda el escrow |
| Orden | En un saldo, la orden de la evidencia es la que guarda el escrow (`orderHash`) |
| Orden de Keel | En un saldo, en el bloque de la transacción: el `importer` de la orden es la `safe()` del FundingGate y el gate tiene al `documentVerifier` con el rol VERIFIER (`hasRole(verificador, 4)`). Sin `fundingGate` en el despliegue, MISMATCH |

**[PROPUESTA] al Área 1:** el verificador lee del archivo de despliegue las claves `pdrGate` (ya la escribe `DeployPDRGate.s.sol`), `fundingGate` y `tradeEscrow`. El script de despliegue de Trade (T1.8) debería usar esos nombres.

# Qué prueba y qué no

Para quién vale: prueba que la decisión firmada sale de esas entradas con esas reglas, que la firmó la llave que el contrato oficial aceptaba en ese bloque y que ese contrato emitió el evento de esa decisión. No prueba que las entradas fueran ciertas (eso depende de la ingesta y del registro de partes).

Límites declarados:

* **El escrow no comprueba `policyHash`.** En un `DocumentDecision`, la cadena comprueba la firma del verificador, la orden, la atestación y el vencimiento, pero no la versión de reglas (riesgo aceptado del escrow, ver [amenazas](../flujo/amenazas.md)). La versión la compara el verificador al volver a correr las reglas, no la cadena.
* **`setPolicyHash` del gate es `onlySafe`.** Que pase por el Delay es una convención mientras no exista ConfigGuard (T1.5).
* **Solo firmas EOA.** Un verificador o firmante ERC-1271 (por ejemplo, una Safe) no se recupera y sale como MISMATCH.
* **Rol VERIFIER en el bloque del saldo.** Si la Safe quita al verificador del gate entre el depósito y la liberación del saldo, el escrow igual acepta su firma, pero el verificador da MISMATCH: no puede probar que esa llave siguiera siendo de Keel.
* **Vencimiento:** que la decisión no dure más que su intención es una regla del motor, no del gate; el resultado la marca como `expiry (engine rule)`.

**Enlaces al explorador:** cuando la red es conocida (Base Sepolia, https://sepolia.basescan.org), `keel verify` imprime el enlace de la transacción y, por cada PDR anclado, el del contrato que emitió el evento, de modo que la salida sirve como evidencia de ejecución para el jurado (elemento 06 de las reglas de la competencia). Sin cadena (modo offline) o con una red desconocida la salida no cambia.

Un PDR de Keel Personal se comprueba (firma, hashes, evento y firmante) pero no se vuelve a ejecutar hasta que exista su motor (T2.2). Una decisión hecha con otra versión de reglas tampoco se vuelve a ejecutar: el verificador pide usar el de esa versión. Las pruebas están en `engine/src/verify.test.ts`, incluidos los dos ataques de la revisión del PR #51: un archivo falso firmado con otra llave y emitido por un contrato propio, y una orden abierta en el escrow real por un tercero que se nombra a sí mismo verificador (`TradeEscrow.open` no pide permiso). Ninguno da MATCH.

**Privacidad:** el archivo contiene datos comerciales de la orden (montos, proveedores conocidos, cupo, RUT del importador). En la demo son datos de prueba; en producción `evidence/` no es público.
