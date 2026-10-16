---
type: Alcance
title: "Alcance: dentro, fuera y lo que no prometemos"
description: "Qué entra en la entrega, qué se declara como trabajo futuro, qué no se promete y la hoja de ruta por fases."
tags: [alcance, trabajo-futuro, hoja-de-ruta]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-16T18:00:00Z }
---

# Dentro

- Importación de productos desde China por empresas chilenas, con liquidación en el corredor Chile y Hong Kong.
- Despliegue en Base Sepolia, una red de prueba pública, con la naviera, el árbitro y el verificador registrados como terceros de confianza en el gate. La red cerrada es el destino del piloto **[PROPUESTA]**.
- Firma de la orden de compra por ambas partes.
- Depósito, bloqueo, anticipo, saldo y reembolso por vencimiento.
- Atestación de embarque firmada por un tercero (en el prototipo, una llave de prueba).
- Lectura y validación del BL (o guía aérea) y de la factura contra la orden.
- Billetera de empresa con rol del agente, cupos, espera y cosignatario.
- Perfiles de importador y exportador, con la aplicación en inglés.
- Keel Personal como segundo modo de la misma billetera: pago de cuentas recurrentes contra facturas autenticadas, a beneficiarios registrados, con cambio de beneficiario con espera y veto ([Keel Personal](../personal/keel-personal.md)). En la aplicación es un tipo de cuenta junto al de empresa. **[PROPUESTA: la profundidad de Keel Personal en la entrega la confirma el equipo, [decisión abierta 14](../decisiones/abiertas.md)]**
- Evidencia con hashes de cada pago, bloqueo y revert.

# Fuera (trabajo futuro, se declara así)

- Integración con plataformas de BL electrónico de navieras.
- Identidad empresarial con credenciales verificables (WeIdentity o similar) y validez legal de la firma (Ley 19.799).
- Bancos y rampas de entrada y salida de dinero fiat.
- Financiamiento: un tercero que deposite a nombre del importador y cobre después.
- KYC, KYB y monitoreo AML/KYT.
- Desaduanamiento: agente de aduana, declaración de ingreso, derechos e IVA.
- Pago del flete a la naviera.
- Certificados por tipo de producto (origen, análisis, salud, Sernapesca, Seremi de Salud).
- Otros corredores y la exportación desde Chile.

# Lo que no prometemos

- Que la IA "valida firmas" en PDFs. Las firmas válidas son criptográficas; la IA solo lee datos.
- Leer cualquier BL automáticamente: no tienen formato estándar entre navieras (Evergreen, Maersk, CMA CGM).
- Reemplazar la carta de crédito, al agente de aduanas o el pago de impuestos de importación.
- Que un exportador en China continental reciba y convierta stablecoins allí: el comercio con criptomonedas está prohibido desde 2021. Por eso el corredor es Chile con Hong Kong. **[ABIERTO: verificar el estado actual de la regulación antes de citarlo]**
- Que el contrato sepa si la mercancía llegó en buen estado.

# Hoja de ruta

| Fase | Qué se agrega | Resultado |
| --- | --- | --- |
| 0. Competencia | Keel Trade en Base Sepolia, con naviera y árbitro representados por llaves de prueba | Flujo de 6 pasos funcionando, verificable con hashes |
| 1. Piloto Chile-Hong Kong | Red cerrada con participantes identificados, identidad verificada de empresas, una naviera o agente de carga como firmante del embarque, stablecoin regulada | Un importador real con un proveedor real |
| 2. Integración bancaria | Banco o proveedor de pagos como riel de liquidación y como financista | Pagos sin exigir cripto a las partes |

La red de la competencia es Base Sepolia; el token de pago sigue por decidir ([decisión abierta 1](../decisiones/abiertas.md)). Qué se recorta si falta tiempo está en [recortes](../trabajo/recortes.md).
