---
type: Bitácora
title: "Bitácora del Área 2"
description: "Qué construyó y qué decidió el Área 2 (motor de política, PDR y claves) cada día: entregas, decisiones, cambios de interfaz que afectan a otras áreas, hallazgos y pendientes."
tags: [bitacora, area-2, motor, pdr, interfaces, decisiones]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T01:00:00Z }
---

Resumen por día del trabajo del Área 2 (Darienn). El detalle de cada decisión vive en el concepto que la cubre; aquí solo se resume y se enlaza. Las tareas están en [Área 2](area-2-motor.md).

# 14 de octubre

## Entregado

| Qué | Tarea | Dónde | Estado |
| --- | --- | --- | --- |
| Interfaces de Keel Trade: extracción de BL y factura sin texto libre, `PurchaseOrder`, `ShipmentAttestation`, `CancelOrder`, `DisputeResolution`, `FundIntent`, `PolicyDecision`, `DocumentDecision`, eventos, errores y estados | T2.1 | `schemas/src/index.ts` | En `dev` (PR #44) |
| Hashes EIP-712 en TypeScript y en Solidity, probados byte a byte contra el contrato compilado | T2.1 | `schemas/src/hash.ts`, `contracts/src/KeelHash.sol` | En `dev` (PR #44) |
| Interfaces de Keel Personal separadas en su módulo, con sus eventos y errores comprobados contra PDRGate | T2.1 | `schemas/src/personal.ts` | En `dev` (PR #44) |
| Decisión de depósito: orden abierta e idéntica a la firmada, orden de esta Safe, proveedor conocido, roles independientes, cupo, monto habitual y plazo | T2.2 | `engine/src/funding.ts` | En `dev` (PR #44) y PR #46 |
| Firma del PDR: decisión, firma, cofirma de nivel 3 y evidencia en `evidence/pdr/<pdrHash>.json`, probada contra el PDRGate real | T2.4 | `engine/src/pdr.ts` | En `dev` (PR #44) |
| Custodia de llaves: tabla de cada llave y reglas en código (una llave por papel, la llave de política solo firma PDR) | T2.7 | [Custodia de llaves](../arquitectura/custodia-de-llaves.md), `engine/src/keys.ts` | PR #46 |
| Decisión de documentos del gatillo 2: 14 reglas contra la atestación, los documentos exigidos, los términos firmados y las señales de fraude | T2.2 | `engine/src/documents.ts` | PR #46 |
| CI: el job de Node descarga los submódulos, porque las pruebas del motor compilan los contratos | | `.github/workflows/ci.yml` | En `dev` (PR #44) |

Pruebas al cierre del día: 246 pasan. Falla solo `ingest/src/settings.test.ts`, que revisa permisos de archivo de Linux y falla en Windows desde antes.

## Decisiones

| Decisión | Quién | Concepto |
| --- | --- | --- |
| Un gate por modo: PDRGate para Personal y un gate propio para Trade. La estructura interna de los gates la define el Área 1 | Áreas 1 y 2 | [PDR](../interfaces/pdr.md) |
| El archivo de evidencia de un PDR se llama por su `pdrHash`, el mismo hash que el gate emite en la cadena | Área 2 | [Evidencia y bitácora](../arquitectura/evidencia-y-bitacora.md) |
| `termsHash` es el hash EIP-712 de `OrderTerms` (número de orden, moneda y monto de la factura, códigos arancelarios y hash del documento), así ambas partes firman los términos contra los que se revisa la factura | Área 2 | [Paso 1](../flujo/paso-1-firma-orden.md) |
| Decisión abierta 3 cerrada: el `DocumentDecision` es obligatorio y lo firma el `documentVerifier` de cada orden, que no es una parte ni la naviera. Salidas: aprobación manual del importador (`BalanceApproval`) y sin reembolso por vencimiento con el embarque probado | Área 2 | [Paso 5](../flujo/paso-5-saldo.md), [decisiones abiertas](../decisiones/abiertas.md) |
| Depósito sobre el cupo sigue siendo nivel 3: el Área 1 agrega un segundo rol con cupo mayor que el gate usa solo con la cofirma | Área 2, a propuesta del Área 1 | [Niveles de permiso](../arquitectura/niveles-de-permiso.md) |
| `blNumberHash` incluye la naviera, porque un número de BL es único por naviera | Área 2, a propuesta del Área 1 | [Datos firmados](../flujo/datos-firmados-e-interfaz.md) |

## Cambios de interfaz que afectan a otras áreas

* **Área 1:**
  * `FundIntent.orderHash`, para comprobar en la cadena que se deposita la orden firmada.
  * `PurchaseOrder.documentVerifier` y el struct `BalanceApproval`.
  * El estado `SHIPPED`.
  * TradeEscrow libera el saldo en dos pasos, no reembolsa órdenes embarcadas y valida al abrir que el verificador sea independiente.
  * `KeelHash.sol` incluye `PaymentIntent` para que PDRGate deje `KeelHashing.sol`.
* **Área 3:**
  * Las extracciones usan `TransportDocumentExtraction` y `CommercialInvoiceExtraction`.
  * Junto a ellas se entrega el keccak256 de cada archivo leído.
  * `blNumberHash` recibe la naviera.
* **Área 4:**
  * Al crear una orden, la app arma `OrderTerms` y calcula `termsHash`.
  * El hash de `PurchaseOrder` cambió por el campo nuevo.
  * En nivel 3 se usa `cosignRequest` para la cofirma.
* **Área 5:**
  * La evidencia de cada PDR queda en `evidence/pdr/<pdrHash>.json`.
  * La tabla de llaves está lista para el informe de seguridad.

## Revisión del Área 1 al PR #44

Pidió cambios en tres puntos de interfaz y varias correcciones, todos aplicados antes del merge:

* `orderHash` en `FundIntent`.
* No afirmar que el proveedor conocido se verifica en la cadena hasta que exista (T1.11).
* El nivel 3 sobre el cupo.
* La decisión del gate como de ambas áreas.
* Comentarios.

Las sugerencias del área del motor también entraron. La especificación de los bytes de `termsHash` entró en el PR #46.

## Hallazgos

* **`CODEOWNERS` no funciona.** El repositorio es privado y la organización está en el plan gratuito de GitHub, así que no se piden revisiones automáticas ni hay protección de ramas. Las revisiones se piden a mano. Falta que el equipo decida si cambia el plan o la visibilidad.
* **Las issues del tablero están desactualizadas.** Las 40 son anteriores al cambio de rumbo y faltan las tareas nuevas (T1.0, T1.9 a T1.11, T2.10, T4.9, T4.10). Su actualización depende de la coordinación (Área 5).
* **Riesgo declarado:** el token de administración de la ingesta puede relajar la exigencia de DMARC ([custodia de llaves](../arquitectura/custodia-de-llaves.md)).
* **Riesgo temporal:** con la llave de política robada se podría depositar una orden con una dirección de cobro nueva, hasta que el gate de Trade verifique el registro de proveedores en la cadena ([amenazas](../flujo/amenazas.md)).

## Pendiente

* PR #46 en revisión del Área 1.
* Tareas del Área 2:
  * T2.5: simulación previa.
  * T2.6: estados y avisos.
  * T2.8: monitor.
  * T2.9: verificador; es la próxima y no depende de otras áreas.
  * T2.10: vigilancia de plazos.
* La firma del PDR de Trade solo espera la función de depósito del gate de Trade (Área 1).
