# Keel, documento técnico completo

**El primer pagador de cuentas básicas resistente a facturas fraudulentas.**

2026 Shenzhen FinTechathon, International Track, Topic F: Agent Wallet
Lema: la IA interpreta una vez, el contrato obedece siempre. Y cuando la IA se equivoca, el contrato no.

---

## 1. Posicionamiento (la decisión más importante)

Keel NO se presenta como "wallet de agente con límites de gasto". Ese concepto está saturado: Coinbase Agentic Wallets (feb 2026), Cobo Agentic Wallet con sus Pacts (abr 2026), Crossmint, Privy, Turnkey, MetaMask Advanced Permissions (ERC-7715), y al menos cinco proyectos solo en ETHGlobal Tokyo 2026 (DSAP, Proviso, Izanagi, Axis, Surety). Un juez ya lo vio.

Keel se presenta como un agente que paga cuentas reales (arriendo, luz, internet) a partir de facturas que llegan por correo, bajo un modelo de amenaza concreto: **la factura fraudulenta que cambia el beneficiario**. Mismo monto, mismo formato, otra dirección, quizás con texto oculto. Ningún competidor identificado ataca ese problema, y es el fraude financiero más común del mundo real llevado a agentes de IA.

Apertura del pitch: el 4 de mayo de 2026 un tuit en código Morse hizo que Grok/Bankrbot drenara unos 3.000 millones de tokens DRB en Base, valorados entre 150 y 200 mil dólares según el OECD AI Incidents Monitor. El ataque funcionó por dos fallas que Keel prohíbe por diseño: un evento externo pudo ampliar los permisos de la wallet, y el LLM que leía contenido público podía disparar transferencias.

---

## 2. El hueco de mercado

El mercado se dividió en dos arquitecturas:

**(a) Políticas fuera de la cadena (MPC, TEE, enclaves):** Coinbase, Cobo, Privy, Turnkey, Skyfire. La regla la hace cumplir el proveedor, no un contrato público que el usuario controle y audite. En Cobo, el Pact se parece al mandato de Keel, pero Cobo comparte la llave en el esquema MPC. En Turnkey, un quórum de usuarios raíz puede saltarse el motor de políticas.

**(b) Permisos en la cadena:** Safe + Zodiac Roles v2 (estándar de producción institucional, lo usan Almanak y Ratehopper), MetaMask ERC-7715 con caveat enforcers (estándar aún en borrador), Crossmint. Granulares y auditables, pero sin capa de IA ni modelo de amenaza de facturas.

**(c) Rieles de tarjetas (Visa Intelligent Commerce, Mastercard Agent Pay, Google AP2, Stripe ACP):** resuelven comercio electrónico y dejan la regla en el emisor. Los mandatos AP2 prueban autorización pero no impiden en la cadena que la llave gaste. Ninguno sirve para arriendo: en Chile casi nadie cobra el arriendo con tarjeta.

El hueco: pagos recurrentes a beneficiarios conocidos, con regla pública y auditable en un contrato, y defensa específica contra fraude de facturas. El competidor fiat más cercano en Chile es Neat Pagos (paga arriendo y servicios con tarjeta y ya usa IA para leer cuentas por correo), pero no es autocustodia, no usa stablecoins y no ofrece garantías verificables.

---

## 3. Arquitectura

### 3.1 Base on-chain: Safe + Zodiac Roles Modifier v2 + Delay Modifier (Base Sepolia)

- Rol del agente: solo `USDC.transfer`, destinatario dentro de la lista blanca {arrendador, distribuidora o puente fiat, ISP}, cupo por periodo.
- El Roles Modifier intercepta la llamada y desensambla el calldata a nivel de máquina virtual: valida destinatario contra la lista blanca, selector de cuatro bytes contra los métodos autorizados, y argumentos posicionales contra condiciones predeterminadas (techos de transferencia, prohibición de cambios de propiedad).
- El dueño del Roles Modifier es la Safe del usuario, nunca el agente. Nada externo puede ampliar permisos (la lección Bankr).
- Módulos auditados y en producción institucional. No se escribe el contrato crítico desde cero. Nota de diligencia: auditorías independientes ya identificaron y mitigaron una falla de trailing bytes padding en el desensamblador MultiSend del Roles Modifier; citarla en el informe demuestra que el equipo conoce la historia de seguridad de su propia base.

### 3.2 Pipeline de factura con doble LLM, versión honesta

- Un LLM en cuarentena lee el contenido no confiable (PDF de la factura, correo, notas) y solo puede devolver un JSON de esquema fijo: emisor, monto, fecha, y beneficiario **referenciado por alias, nunca por dirección libre**.
- El LLM operativo jamás ve el texto crudo, solo el objeto validado.
- Limitación reconocida y resuelta: el patrón dual LLM (Willison, 2023) protege el flujo de control pero no el flujo de datos, como documenta CaMeL (Google DeepMind y ETH Zurich, arXiv 2503.18813). Un LLM en cuarentena manipulado puede devolver un valor falso (otro monto, otra referencia) dentro de un esquema válido. Eso es exactamente el fraude de facturas. Por eso la defensa decisiva no está en el esquema JSON sino en que la dirección nunca proviene del documento: el alias se resuelve contra la lista blanca on-chain, y el monto se valida contra el cupo del rol.
- En el pitch se dice explícitamente: asumimos que la IA puede fallar, y demostramos que aun así el contrato rechaza.

### 3.3 Registro de Decisión de Política (PDR)

Adoptado del marco académico PACE (Policy-Attested Contract Execution, arXiv 2608.17220), cuyo axioma es el mismo de Keel: el LLM propone, el verificador dispone y la cadena hace cumplir.

Flujo por transacción:

1. El motor de reglas determinista (función pura, sin acceso al LLM ni a la red) valida la intención contra la política.
2. La transacción se simula en un fork local (Anvil): cálculo exacto de balances finales y reversión preventiva.
3. Se emite un PDR firmado que enlaza de forma indisoluble: hash de la intención, identificadores de la política, resultados simulados y hash keccak256 del calldata exacto que irá a la red.
4. Cualquier divergencia de un byte entre lo aprobado y lo enviado invalida la ejecución.

En las evaluaciones del paper, PACE logró 0,00 de ejecuciones inseguras con 0% de falsos positivos sobre 2.800 ensayos. Implementar una versión de este registro convierte "tenemos reglas" en "tenemos un compromiso criptográfico verificable por transacción".

### 3.4 Niveles de permiso

| Nivel | Nombre | Qué cubre | Ejecución |
|---|---|---|---|
| 0 | Leer | Consultar, analizar, proponer | Sin transacción |
| 1 | Autónomo | Beneficiario conocido, bajo el cupo | Inmediata |
| 2 | Con retraso | **Beneficiario nuevo o modificado** | Delay Modifier: N horas de espera, aviso al usuario, firma de la Safe para activar |
| 3 | Firma humana | Montos grandes | Requiere al usuario o cosignatario |
| 4 | Imposible | Modificar roles, vaciar, aprobaciones ilimitadas | El contrato lo rechaza siempre, para cualquiera |

El nivel 2 aplicado a cambios de beneficiario es el protocolo anti fraude de facturas y casi no existe en el mercado: hay umbrales de monto por todas partes, pero el retraso forzoso sobre beneficiarios nuevos no aparece en los competidores analizados.

El cosignatario puede aprobar o frenar, pero no puede iniciar envíos ni retirar hacia sí mismo: el guardián tampoco puede robar.

### 3.5 Bitácora de bloqueos con evidencia dura

Cada intento queda registrado con estado (ejecutado, bloqueado off-chain por el motor de reglas, revertido on-chain por el contrato), motivo, hash de la factura de origen y hash de transacción cuando existe.

La joya probatoria: una transacción revertida por el Roles Modifier en la cadena, lanzada deliberadamente con la llave del agente hacia un destinatario fuera de la lista. Ese revert público es la mejor prueba de que ni una llave comprometida puede robar, y alimenta el bonus on-chain.

---

## 4. Qué se recorta y por qué

- **Tesorería con rendimiento DeFi:** fuera. Concepto saturado, resta foco y agrega superficie de riesgo.
- **Efecto red de atestaciones (EAS):** lámina de trabajo futuro, no código, salvo que sobren días (ver anexo A.4).
- **Compilador de mandato en lenguaje natural:** degradado de invento central a capa de experiencia. Cobo (Pacts) y la pantalla legible de MetaMask ya existen. Si se implementa, el valor diferencial es el diff legible: lo que el contrato permitirá y lo que nunca podrá hacer, comparado explícitamente con la pantalla ERC-7715 para mostrar dominio del estado del arte.
- **Puente a pesos chilenos:** honestidad total. La lista blanca contiene la dirección del arrendador que acepta USDC y la dirección de depósito del puente fiat (Buda u Orionx como referencia); la conversión automática a pesos es trabajo futuro. Se declara antes de que el jurado lo pregunte.

---

## 5. Demo en 4 actos, cada uno con hash real

1. **Flujo feliz:** factura de luz real (PDF anonimizado): lectura, JSON, regla, simulación, PDR, pago. Hash en BaseScan.
2. **La factura fraudulenta:** mismo formato, beneficiario cambiado, texto oculto con instrucciones. Se muestra que el LLM en cuarentena extrae la dirección falsa (la IA falla) y el sistema la rechaza porque el alias no resuelve en la lista blanca. Bloqueo registrado en la bitácora.
3. **Beneficiario nuevo legítimo:** el arrendador cambia de cuenta. Nivel 2: retraso de N horas, aviso, firma de la Safe. Se muestra la ventana de veto.
4. **El robo directo:** con la llave del agente se intenta transferir a una dirección externa. El Roles Modifier revierte on-chain. Hash del revert en pantalla.

Cierre: tabla con N facturas legítimas pagadas, M ataques bloqueados, 0 fondos perdidos.

---

## 6. Alineación con WeBank

- Estrategia de banco nativo de IA (declarada en marzo de 2025, más de 800 agentes internos al cierre de 2025) con humano en el circuito: Keel es autonomía con veto humano estructural.
- Patrón de ganadores del FinTechathon: en 2025 ganó un motor que convierte lenguaje natural en estrategias ejecutables; en 2024 los premios de blockchain fueron supervisión y confianza para IA sobre FISCO BCOS. Keel calza en ambos patrones.
- Lámina de portabilidad a FISCO BCOS: compatible EVM, con Web3 RPC mejorado desde v3.16 (eth_subscribe, estimateGas) y endurecimiento de seguridad en v3.17. Si alcanza el tiempo, desplegar el contrato de política en una testnet FISCO BCOS como exploración.
- KYT/AML como trabajo futuro, en el idioma del banco. WeBank en Hong Kong avanza en cadenas reguladas, AML/KYT y custodia de activos virtuales.

---

## 7. Informe de seguridad (30% del puntaje)

Matriz de amenazas, cada una con control y riesgo residual:

| Amenaza | Control | Riesgo residual |
|---|---|---|
| Prompt injection en factura (OWASP LLM01) | Doble LLM, esquema fijo, alias | El LLM en cuarentena puede extraer valores falsos; los frena la lista blanca y el cupo |
| Agencia excesiva (OWASP LLM06) | Rol Zodiac con selector y parámetros | Acciones dentro del rol siguen siendo posibles |
| Robo de la llave del agente | La llave solo sirve dentro del rol | Puede gastar el cupo del periodo hacia la lista blanca |
| Cambio de beneficiario | Alias + nivel 2 con retraso y firma | Ventana de ingeniería social al humano que firma |
| Evento externo que amplía permisos (estilo Bankr) | Solo la Safe gobierna los módulos | Compromiso de la propia Safe |
| Agente intenta modificar roles | Nivel 4, el contrato lo rechaza | Ninguno conocido |
| Repetición de pagos | Cupo por periodo, idempotencia por hash de factura | Facturas legítimas duplicadas requieren revisión |
| Caída o degradación del LLM | El motor determinista no depende del LLM | Pagos se detienen, nunca se ejecutan mal |

Riesgos declarados con honestidad: la simulación depende del RPC; USDC tiene riesgo de emisor y congelamiento; el puente fiat es centralizado; el código propio no está auditado; la bitácora prueba lo que el sistema registró, no que nada se haya escapado.

---

## 8. Métricas del red team

Batería de 30 a 50 escenarios documentados: urgencia, secreto, falsa autoridad, direcciones envenenadas, injection en facturas, aprobaciones ilimitadas, manipulación de montos, beneficiario cambiado.

- Tasa de bloqueo de ataques.
- Tasa de falsos positivos sobre facturas legítimas.
- Porcentaje de tareas completadas sin intervención humana.
- Latencia de decisión.

Resultados publicados en el repositorio como red team abierto.

---

## 9. Stack

| Componente | Tecnología |
|---|---|
| Smart account | Safe |
| Permisos del agente | Zodiac Roles Modifier v2 |
| Retraso de beneficiarios | Zodiac Delay Modifier |
| Red | Base Sepolia, más transacciones de centavos en Base mainnet |
| Cliente blockchain | viem sobre Node.js |
| Simulación | Anvil (fork local) |
| Registro de decisión | PDR firmado (inspirado en PACE) |
| Canal de avisos y firmas | Bot de Telegram |
| Agente | LLM con tool calling, patrón de doble LLM |

---

## 10. Plan de 3 semanas

| Días | Entregable |
|---|---|
| 1 a 4 | Safe + Roles v2 + Delay en Base Sepolia. Rol del agente operativo. Primer revert on-chain conseguido |
| 4 a 8 | Motor de reglas determinista, simulación en Anvil, PDR firmado |
| 7 a 11 | Pipeline de facturas: LLM en cuarentena, esquema JSON, resolución por alias. Facturas reales de prueba |
| 10 a 13 | Nivel 2 (beneficiario nuevo con retraso y firma), bitácora completa, transacciones de centavos en Base mainnet |
| 12 a 16 | Red team: 30 a 50 escenarios, tabla de métricas |
| 15 a 19 | Informe de seguridad, README, deck de 10 minutos, video de 5 minutos, todo en inglés |
| 19 a 20 | Margen y pulido. Nada nuevo entra en los últimos 2 días |

Regla de recorte: si algo se atrasa, cae en este orden: FISCO BCOS, compilador de mandato, EAS. Nunca caen los 4 actos de la demo ni el informe de seguridad.

---

## 11. Pendientes urgentes (esta semana)

Correo a la organización (wangyr@pbcsf.tsinghua.edu.cn):

1. ¿Testnet cuenta como "real on-chain transaction hashes" o se exige mainnet? Las transacciones de centavos en Base mainnet cubren el riesgo mientras tanto.
2. Conflicto de fechas: las bases indican cierre el 20 de octubre, pero la página de IEEE CIS Shenzhen publica una cronología tentativa con cierre preliminar el 2 de noviembre. Planificar para el 20 y confirmar; no contar con la holgura.
3. Composición del equipo: 2 a 5 integrantes, al menos 60% no chinos.

---

## Anexo A: material técnico de respaldo (para preguntas del jurado)

### A.1 Enclaves TEE (trabajo futuro declarado)

El doble LLM protege el contenido, pero el servidor donde corre el agente sigue siendo superficie de ataque: exfiltración de la llave de sesión o manipulación del proceso por el sistema operativo o el proveedor de nube. La mitigación de estado del arte es encerrar la inferencia y las credenciales en un enclave de ejecución confiable con atestación criptográfica de código, como el framework dstack de Phala Network sobre procesadores Intel TDX. Se declara como trabajo futuro en el informe: demuestra que el equipo conoce la capa que falta sin intentar construirla en 3 semanas.

### A.2 Por qué no Smart Sessions (ERC-7579)

Si un juez pregunta por qué no se usaron cuentas modulares ERC-4337/7579 con Smart Sessions (Rhinestone/Biconomy): las políticas canónicas como ERC20SpendingLimitPolicy solo validan los selectores estándar (transfer, transferFrom, approve, increaseAllowance). Si el agente participa en protocolos de pago máquina a máquina como x402, basado en transferWithAuthorization (EIP-3009), la política no reconoce el selector y revoca la validación. El Roles Modifier de Zodiac, con inspección profunda de calldata y condiciones por parámetro, cubre más superficie con módulos ya auditados. Además, ERC-7715 sigue en borrador.

### A.3 Comparación con los análogos más cercanos

| Dimensión | Keel | Lit Protocol (Vincent) | Marco PACE (académico) |
|---|---|---|---|
| Entrada del usuario | Mandato compilado a reglas de contrato | Selección de habilidades delegadas con políticas programadas | Política declarativa formalizada |
| Verificación | Motor determinista off-chain + simulación en fork | Código JavaScript inmutable en IPFS auditado por nodos Lit | Función determinista pura sin acceso al LLM |
| Compromiso criptográfico | Configuración fija en módulos Zodiac + PDR + bitácora | Firma distribuida (DKG) en nodos TEE condicionada a la política | PDR con hash de calldata |
| Ejecución on-chain | Safe verificada por Roles v2 y Delay | Cuenta PKP con delegación de firma | Smart account con verificación de firma PDR |
| Autonomía | 5 niveles estratificados (0 a 4) | Delegación binaria por habilidad | Permiso condicionado: ejecución válida o reversión |

Keel combina la base auditada de Zodiac con el rigor probatorio de PACE y agrega lo que ninguno tiene: el modelo de amenaza de facturas y el nivel de retraso para beneficiarios.

### A.4 Efecto red formalizado (ERC-8004 y EAS)

La idea de que un bloqueo en una wallet inmunice a las demás tiene formalización comunitaria en el estándar propuesto ERC-8004, una capa de confianza para la economía de agentes con tres registros: identidad (fichas ERC-721), reputación (historial auditable de rendimiento y eventos adversos) y validación (verificación criptoeconómica o criptográfica, incluidas pruebas de conocimiento cero y atestaciones TEE). Proyectos como Attestix y ATLAST ya anclan lotes de evidencia con raíces de Merkle vía EAS en Base. Para Keel es la lámina de visión: las atestaciones de bloqueo de Keel serían registros de reputación negativos consultables por cualquier wallet suscrita.

### A.5 Incidentes citables en el pitch

- **Freysa (nov 2024):** 13,19 ETH (unos 47 mil dólares) extraídos por ingeniería social en el intento 482.
- **AIXBT (mar 2025):** 55,5 ETH; el desarrollador atribuye el ataque a acceso a infraestructura, no al agente.
- **Grok/Bankrbot (may 2026):** el caso central. Primero un NFT amplió los permisos de la wallet, luego una instrucción en código Morse decodificada por Grok ejecutó el drenaje. Entre 150 y 200 mil dólares según OECD AI Incidents Monitor, unos 175 mil según SlowMist. MetaMask lo calificó como el primer exploit documentado de su tipo. Cerca del 80% se recuperó después.
- **Zscaler (vía SecurityWeek):** sitios con prompts ocultos que piden a agentes pagar en cripto para obtener una API key.
- No usar sin confirmar: la supuesta vulnerabilidad de Coinbase AgentKit (abril 2026) solo aparece en una fuente de baja calidad.

### A.6 Contexto de pago de cuentas en Chile (para la narrativa de impacto)

- Buda.com y Orionx convierten cripto a pesos; Global66 ofrece cuenta USDT/USDC con conversión local.
- Neat Pagos paga arriendo y servicios con tarjeta y automatiza con IA leyendo correos: valida que el caso de uso es real, sin autocustodia ni garantías verificables.
- No se encontró un servicio chileno que pague una cuenta de luz directamente en USDC. Es una suposición fuerte del análisis, no un hecho probado: verificar antes del pitch.
- Región: DIRECTV/DGO en Argentina acepta USDT/USDC vía Exodus Checkout (según Exodus); Cobre (Colombia) reportó 81% de crecimiento interanual en pagos empresariales con stablecoins en el primer semestre de 2026.

### A.7 Trabajo futuro (mencionar, no construir)

Puente a pesos con Buda u Orionx; x402/AP2 como formato de interoperabilidad; identidad del agente con WeIdentity o KYA; KYT/AML; enclaves TEE (A.1); ERC-8004 (A.4); recuperación social de la Safe; auditoría externa; despliegue en FISCO BCOS.
