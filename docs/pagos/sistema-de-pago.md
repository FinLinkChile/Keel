---
type: Pagos
title: "Sistema de pago"
description: "Qué token y red se usan en cada modo, entrada y salida de fiat, tipo de cambio, los tres modelos de liquidación y el financiamiento."
tags: [token, red, fiat, tipo-de-cambio, liquidacion, bancos]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

# Qué dinero se mueve

| Modo | Token | Red | Por qué |
| --- | --- | --- | --- |
| Trade (competencia) | Stablecoin disponible en la red elegida, o un token de prueba declarado como tal **[ABIERTO]** | Red cerrada por definir; FISCO BCOS es la candidata natural **[ABIERTO]** | Participantes identificados y un entorno que un banco puede operar |
| Trade (piloto) | Stablecoin regulada en la jurisdicción del pago (Hong Kong) | La que soporte esa stablecoin | Las partes necesitan un activo legal en su país |
| Personal | USDC en el diseño original; se alinea con el token de la red elegida **[ABIERTO]** | Base Sepolia en el diseño original; se decide junto con la red de Trade **[ABIERTO]** | Estable y con costos bajos por pago |

# Entrada y salida de dinero fiat

- **Personal en Chile:** el usuario compra USDC con pesos en un exchange local y lo deposita en su Safe. El beneficiario recibe USDC; si quiere pesos, los convierte en un exchange. El puente directo a pesos es trabajo futuro y se declara así.
- **Trade:** cada parte necesita convertir entre su moneda y la stablecoin. Este es el mayor obstáculo práctico y depende de la regulación de cada país ([regulación](regulacion.md)).

# Tipo de cambio

- Personal: dos fuentes (dólar observado del Banco Central y un exchange local). Si difieren más de 1,5% se retiene el pago; se paga con la tasa menos favorable más un margen. El cupo del Roles acota el daño aunque se manipule una fuente.
- Trade: el monto se pacta en la orden directamente en la stablecoin, así que el contrato no necesita tipo de cambio. La conversión ocurre fuera, al entrar y al salir.

# Tres modelos de liquidación (para responder "¿y los bancos?")

| Modelo | Cómo funciona | Cuándo sirve |
| --- | --- | --- |
| 1. Todo en la cadena | Escrow y pago en stablecoin | Hoy, entre partes que pueden usar stablecoins |
| 2. Híbrido | Keel decide y deja la evidencia en la cadena; un banco ejecuta el pago tradicional por API | Cuando las partes no pueden o no quieren usar cripto |
| 3. Bancos en la cadena | Depósitos tokenizados o stablecoins emitidas por bancos | A futuro; calza con lo que explora WeBank |

Frase para el jurado: **"Keel no reemplaza al banco; hace que el pago solo ocurra cuando se cumplen condiciones verificables, sea cual sea el riel de pago."**

# Financiamiento

Una carta de crédito también financia: el importador paga a 30 o 60 días. Un escrow exige tener el total desde el inicio. La extensión natural es que un **financista** (por ejemplo, un banco) deposite en el escrow a nombre del importador y cobre después. Es una oportunidad de negocio para el banco, no una amenaza. **[DISEÑO]**
