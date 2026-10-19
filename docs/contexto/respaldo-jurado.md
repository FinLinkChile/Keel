---
type: Contexto
title: "Material de respaldo para preguntas del jurado"
description: "Enclaves TEE, por qué no Smart Sessions, comparación con Lit y PACE, incidentes citables, contexto de comercio exterior y trabajo futuro."
tags: [jurado, tee, erc-7579, pace, incidentes]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

# Enclaves TEE (trabajo futuro declarado)

El extractor en cuarentena protege el contenido, pero el servidor donde corre el agente sigue siendo superficie de ataque: exfiltración de la llave de política o manipulación del proceso por el sistema operativo o el proveedor de nube. La mitigación de estado del arte es encerrar la inferencia y las credenciales en un enclave de ejecución confiable con atestación criptográfica de código, como el framework dstack de Phala Network sobre procesadores Intel TDX. Se declara como trabajo futuro en el informe.

# Por qué no Smart Sessions (ERC-7579)

Si un juez pregunta por qué no se usaron cuentas modulares ERC-4337/7579 con Smart Sessions (Rhinestone/Biconomy): las políticas canónicas como ERC20SpendingLimitPolicy solo validan los selectores estándar (transfer, transferFrom, approve, increaseAllowance). El agente de Keel no hace transferencias directas: llama a funciones de un contrato de escrow, y necesita condiciones por parámetro sobre esas llamadas. El Roles Modifier de Zodiac, con inspección profunda de calldata, cubre ese caso con módulos ya auditados. Además, ERC-7715 sigue en borrador.

# Comparación con los análogos más cercanos

| Dimensión | Keel | Lit Protocol (Vincent) | Marco PACE (académico) |
|---|---|---|---|
| Entrada | Orden de compra firmada por ambas partes | Selección de habilidades delegadas con políticas programadas | Política declarativa formalizada |
| Verificación | Motor determinista off-chain más simulación | Código JavaScript inmutable en IPFS auditado por nodos Lit | Función determinista pura sin acceso al LLM |
| Compromiso criptográfico | Módulos Zodiac, PDR, atestación de la naviera y bitácora | Firma distribuida (DKG) en nodos TEE condicionada a la política | PDR con hash de calldata |
| Ejecución on-chain | Safe verificada por Roles v2 y Delay, más un contrato de escrow | Cuenta PKP con delegación de firma | Smart account con verificación de firma PDR |
| Autonomía | 5 niveles estratificados (0 a 4) | Delegación binaria por habilidad | Permiso condicionado: ejecución válida o reversión |

Keel combina la base auditada de Zodiac con el rigor probatorio de PACE y agrega lo que ninguno tiene: pagos condicionados a hechos del comercio exterior, con la cuenta de cobro y la prueba de embarque fuera del alcance de la IA.

# Incidentes citables en el pitch

- **Freysa (nov 2024):** 13,19 ETH (unos 47 mil dólares) extraídos por ingeniería social en el intento 482.
- **AIXBT (mar 2025):** 55,5 ETH; el desarrollador atribuye el ataque a acceso a infraestructura, no al agente.
- **Grok/Bankrbot (may 2026):** el caso central. Primero un NFT amplió los permisos de la wallet, luego una instrucción en código Morse decodificada por Grok ejecutó el drenaje. Entre 150 y 200 mil dólares según OECD AI Incidents Monitor, unos 175 mil según SlowMist. MetaMask lo calificó como el primer exploit documentado de su tipo. Cerca del 80% se recuperó después.
- **Zscaler (vía SecurityWeek):** sitios con prompts ocultos que piden a agentes pagar en cripto para obtener una API key.
- No usar sin confirmar: la supuesta vulnerabilidad de Coinbase AgentKit (abril 2026) solo aparece en una fuente de baja calidad.
- Falta un caso citable de fraude por cambio de cuenta en comercio exterior, con fuente. Por buscar.

# Contexto de comercio exterior (para la narrativa de impacto)

De la entrevista con el importador ([entrevista](entrevista-importador.md)):

- Dos casos reales documentados: un repuesto aéreo desde Alemania (orden, anticipo por SWIFT y embarque en 11 días) y agar por vía marítima con pago a 30 días desde el embarque.
- El BL es título de propiedad de la carga y la fecha *on board* es el dato crítico.
- El entrevistado considera la idea vigente: hay mucho papel por automatizar y agencias de aduana ya exploran algo similar.
- Su conocimiento es del caso chileno. Lo que ocurre del lado del exportador en China o Hong Kong está por validar.

# Trabajo futuro (mencionar, no construir)

BL electrónico de navieras; identidad con WeIdentity o KYA; bancos como riel de liquidación y como financistas; depósitos tokenizados; KYT/AML; enclaves TEE; pago diferido a N días del embarque; otros corredores y la exportación desde Chile; recuperación social de la Safe; auditoría externa.
