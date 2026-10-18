---
type: Paso del flujo
title: "Paso 1: firma de la orden de compra"
description: "Qué condiciones quedan firmadas por importador y exportador (EIP-712), por qué payoutAddress frena el fraude de cambio de cuenta y qué verifica open."
tags: [paso-1, eip-712, payout-address, open]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T02:30:00Z }
---

Importador y exportador firman el **mismo digest EIP-712** desde sus billeteras. Si son Safes de empresa, firman con ERC-1271.

Lo que queda escrito y firmado:

| Condición | Campo | Ejemplo |
| --- | --- | --- |
| Dónde cobra el exportador | `payoutAddress` | Fijada aquí, firmada por ambos |
| Moneda | `token` | Stablecoin permitida en la red |
| Monto total | `totalAmount` | 10.000 dólares en esa stablecoin |
| Anticipo | `advanceBps` | 5000 (50%) |
| Fecha límite de embarque | `shipmentDeadline` | Se compara con la fecha *on board* |
| Ventana de disputa | `disputeWindow` | Días tras el embarque |
| Quién prueba el embarque | `carrier` | Naviera o agente de carga registrado |
| Quién resuelve disputas | `arbiter` | Tercero independiente |
| Quién verifica los documentos | `documentVerifier` | Tercero independiente que firma el `DocumentDecision` del gatillo 2 |
| Incoterm | `incoterm` | CIF |
| Términos de la orden | `termsHash` | Hash EIP-712 de `OrderTerms`: número de orden, moneda y monto de la factura, códigos arancelarios y hash del documento completo con la proforma |
| Documentos exigidos | `requiredDocsHash` | BL y factura |

**La consecuencia antifraude más importante:** `payoutAddress` va dentro de lo firmado por ambos. Un correo que diga "cambiamos de cuenta" no sirve de nada: cambiar la cuenta de cobro exige una orden nueva firmada por ambas partes.

Con los términos pasa lo mismo: como `termsHash` es el hash de datos estructurados (`OrderTerms`) y va dentro de la orden, ambas partes firman también el número de orden, el monto y la moneda de la factura y la mercancía. En el gatillo 2 el motor compara la factura contra esos términos; si no son exactamente los firmados, el saldo se retiene. Se calcula con `termsHash` de `schemas/src/hash.ts`: es el `hashStruct` EIP-712 de `OrderTerms(string orderNumber,string currency,uint256 invoiceAmountMinor,string[] hsCodes,bytes32 documentHash)`, con los códigos arancelarios sin repetir y ordenados de menor a mayor, y `documentHash` igual al keccak256 de los bytes del documento completo. Cuando la orden sale de una proforma, ese documento es la proforma: `documentHash` es el `fileHash` que devuelve la [lectura de la proforma](../interfaces/lectura-de-proforma.md) (decisión del Área 4).

Esto también resuelve el dolor del papel: sin la firma del exportador no hay orden, y sin orden no hay anticipo.

# Cómo se firma en la app

**[PROPUESTA]** del Área 4 (16 de octubre), sigue la pantalla 03c del diseño. Falta que el equipo la confirme.

1. El importador arma la orden desde la proforma y la envía **sin firmar**.
2. El exportador la revisa (T4.2) y **firma primero**.
3. El importador **firma último**, y esa firma es la que deja la orden lista para abrir y depositar. Así quien paga autoriza al final, sobre una versión que el proveedor ya aceptó.

Al contrato le da igual el orden: `open` exige las dos firmas sobre el mismo digest. Las comprobaciones de la app son defensa en profundidad y no reemplazan las del contrato, el FundingGate ni el motor:

| Antes de firmar | Quién | Dónde |
| --- | --- | --- |
| `termsHash` de los `OrderTerms`, `orderId` derivado de las dos partes y las reglas de `open` | Ambos | `app/src/data/signOrder.ts` |
| La cuenta de cobro es la registrada para su empresa | Exportador | `app/src/data/signOrder.ts` |
| La firma del exportador recupera a `po.exporter` y la orden es, campo por campo, la que se envió | Importador | `app/src/data/proposalFlow.ts` |

Pruebas: `app/src/data/signOrder.test.ts` y `app/src/data/proposalFlow.test.ts` (firmas que recuperan a la parte correcta, cuenta, monto o plazo alterados, firma de otra llave o de otro escrow).

**Simplificación de la demo.** La orden viaja entre las dos partes **en el mismo teléfono**: queda guardada en el dispositivo y el teléfono tiene dos llaves de prueba, una por rol. Para quién vale y para quién no:

* Las firmas son EIP-712 reales sobre el dominio del `TradeEscrow`, y `open` las acepta igual que las de dos billeteras.
* Las dos firmas **no vienen de partes independientes**: lo que la demo muestra es que el contrato y las comprobaciones se cumplen, no que dos empresas distintas acordaron.
* La comparación contra lo enviado protege de un archivo corrupto o editado en el teléfono, no de un segundo dispositivo.
* Las llaves nunca salen del teléfono ni llegan a un servidor.

Fuera de esta propuesta, y abiertos: quién llama a `open` (la app o el agente) y cómo recibe el agente la orden y sus términos ([decisión abierta 15](../decisiones/abiertas.md)).

# Qué verifica el contrato al abrir (`open`)

1. Que `orderId` sea `keccak256(abi.encode(importer, exporter, nonce))` (`BadOrderId`) y no exista ya (`OrderExists`). Cada versión nueva de una orden usa un nonce nuevo.
2. Que la firma del importador sea válida para `importer` y la del exportador para `exporter`.
3. Que `advanceBps <= 10000`, `totalAmount > 0` (y no tan grande que el cálculo del anticipo desborde) y `shipmentDeadline` esté en el futuro.
4. Que `carrier`, `arbiter` y `documentVerifier` no sean el importador, el exportador ni `payoutAddress`, que `documentVerifier` no sea la naviera ni el árbitro, y que la naviera no sea el árbitro (quien atesta el embarque no juzga una disputa sobre él). Ninguno de los tres puede ser el propio escrow. Independencia: liberar el saldo exige dos firmas de terceros distintos. El contrato solo detecta la misma dirección exacta; que el verificador sea la llave de Keel lo exigen el motor y el gate.
5. Que el token esté en la lista de tokens permitidos.

Si las partes son Safes de empresa, la Safe valida que firmaron sus representantes según su umbral. El struct completo de la orden está en [datos firmados e interfaz](datos-firmados-e-interfaz.md).
