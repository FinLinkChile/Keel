---
type: Objetivo
title: "Objetivo de Keel"
description: "Qué es Keel, qué construye el proyecto, los dos modos (Trade y Personal), el corredor y el lema."
tags: [objetivo, modos, corredor]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

Keel es un **agent wallet para comercio exterior**: una billetera operada por un agente de IA que paga órdenes de compra internacionales **solo cuando se cumplen condiciones verificables**, usando un contrato de escrow programable en lugar de la custodia bancaria de una carta de crédito.

En una carta de crédito, los bancos guardan la plata y la liberan cuando se cumplen las condiciones. En Keel, un smart contract hace lo mismo:

1. El importador deposita los fondos en el contrato. Quedan bloqueados: el importador ya no puede retirarlos libremente y el exportador todavía no los recibe.
2. El contrato tiene escritas las condiciones de la orden de compra: documentos exigidos, montos y plazos.
3. **Gatillo 1:** orden de compra aceptada por ambos. Se libera el anticipo.
4. **Gatillo 2:** embarque probado, con BL y factura validados. Se libera el saldo.
5. **Vencimiento:** si pasa la fecha de embarque y no llega la prueba, el saldo vuelve al importador.

**Contexto:** la importación de productos desde China por parte de empresas chilenas, que es el caso validado en la entrevista. El mismo principio, pagar solo contra condiciones verificables, se aplica en Keel Personal a las cuentas recurrentes de una persona (arriendo, luz, internet), contra facturas autenticadas y a beneficiarios ya registrados.

**Corredor objetivo:** Chile con Hong Kong, sobre una **red cerrada** (permisionada, con participantes identificados). En China continental el comercio con criptomonedas está prohibido desde 2021, por lo que la liquidación se plantea en Hong Kong.

Lema: **la IA interpreta una vez, el contrato obedece siempre.**

Competencia: 2026 Shenzhen FinTechathon, International Track, Topic F: Agent Wallet.

# Los dos modos

Keel tiene dos modos sobre la misma billetera. **Keel Trade** (empresas, comercio exterior con escrow) es el flujo clave y la demo principal. **Keel Personal** (personas, pago de cuentas) está dentro del alcance como segundo modo; su diseño está en [Keel Personal](../personal/keel-personal.md). **[PROPUESTA: la profundidad de Keel Personal en la entrega la confirma el equipo, [decisión abierta 14](../decisiones/abiertas.md)]**

| | Keel Personal | Keel Trade (modo principal) |
| --- | --- | --- |
| Para quién | Personas y hogares | Empresas importadoras y exportadoras |
| Qué paga | Cuentas recurrentes: arriendo, luz, internet | Órdenes de compra internacionales: anticipo y saldo |
| Contra qué paga | Facturas autenticadas, a beneficiarios ya registrados | Orden de compra firmada por ambas partes y prueba de embarque firmada por la naviera |
| Pieza central en cadena | PDRGate sobre una Safe con Zodiac Roles y Delay | Contrato de escrow (TradeEscrow) más las mismas piezas de seguridad |
| Quién decide | El motor de política, determinista; la IA solo lee | Las firmas de las partes y de la naviera; el motor verifica documentos |
| Estado en la competencia | Dentro del alcance como segundo modo **[PROPUESTA: profundidad por confirmar]** | **Se construye y se demuestra** |

# Cambio de rumbo

El 13 de octubre de 2026 el foco del proyecto pasó del pago de cuentas a la aplicación del flujo de escrow a la importación de productos. Keel Personal volvió al alcance el mismo día, como segundo modo. Los README de cada carpeta de código, las interfaces de `schemas/` y `contracts/src/` y `.env.example` son anteriores al cambio: sirven para Keel Personal, pero no son modelo para los componentes de Keel Trade.
