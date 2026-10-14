# Keel, documento técnico completo

**Un agent wallet para comercio exterior: paga órdenes de compra internacionales solo cuando se cumplen condiciones verificables.**

2026 Shenzhen FinTechathon, International Track, Topic F: Agent Wallet
Lema: la IA interpreta una vez, el contrato obedece siempre. Y cuando la IA se equivoca, el contrato no.

**Cambio de rumbo (13 de octubre de 2026):** este documento describía a Keel como pagador de cuentas básicas. El proyecto es ahora la aplicación del flujo de escrow a la importación de productos desde China por empresas chilenas, con el corredor Chile y Hong Kong como objetivo, sobre una red cerrada. La base de agent wallet (Safe, Zodiac Roles y Delay, PDR, niveles de permiso) se mantiene. El objetivo y el flujo están definidos en [flujo_clave.md](flujo_clave.md), que manda si hay diferencias. El diseño detallado del contrato está en la sección 5 de [KEEL_SOLUCION_ALCANCE.md](KEEL_SOLUCION_ALCANCE.md).

---

## 1. Posicionamiento (la decisión más importante)

Keel NO se presenta como "wallet de agente con límites de gasto". Ese concepto está saturado: Coinbase Agentic Wallets (feb 2026), Cobo Agentic Wallet con sus Pacts (abr 2026), Crossmint, Privy, Turnkey, MetaMask Advanced Permissions (ERC-7715), y al menos cinco proyectos solo en ETHGlobal Tokyo 2026 (DSAP, Proviso, Izanagi, Axis, Surety). Un juez ya lo vio.

Keel tampoco se presenta como "un escrow en blockchain". Un escrow por sí solo no necesita un agente.

Keel se presenta como un agente que opera la billetera de una empresa importadora: lee proformas, órdenes de compra, conocimientos de embarque y facturas, prepara los pagos y vigila los plazos, bajo dos modelos de amenaza concretos:

1. **El correo del "proveedor" que avisa que cambió su cuenta** justo antes del pago. Es el fraude más común del comercio exterior.
2. **El documento de embarque falso o manipulado** que intenta gatillar un pago por una carga que no se embarcó.

La respuesta de Keel: la cuenta de cobro va dentro de la orden de compra firmada por ambas partes, la prueba de embarque la firma un tercero (la naviera) y los fondos viven en un contrato de escrow que solo puede pagar a las partes de la orden.

Apertura del pitch: el 4 de mayo de 2026 un tuit en código Morse hizo que Grok/Bankrbot drenara unos 3.000 millones de tokens DRB en Base, valorados entre 150 y 200 mil dólares según el OECD AI Incidents Monitor. El ataque funcionó por dos fallas que Keel prohíbe por diseño: un evento externo pudo ampliar los permisos de la wallet, y el LLM que leía contenido público podía disparar transferencias. Trasladado al comercio exterior: un agente que lee un PDF y paga a la cuenta que el PDF indica es el mismo error.

---

## 2. El hueco de mercado

### 2.1 Lo que hay hoy en comercio exterior

Validado en la entrevista con un importador chileno ([reunion_comercio_exterior.md](reunion_comercio_exterior.md)):

- **Carta de crédito:** dos bancos custodian el pago y lo liberan contra documentos. Da garantía, pero es cara y lenta. Con China casi no se usa.
- **Transferencia directa:** por ejemplo 50% de anticipo y 50% al embarcar. Es lo habitual con China. No hay garantía: el importador confía en la reputación del proveedor. Cada transferencia cuesta unos 70 mil pesos y tarda por revisiones manuales.
- **Papel:** las órdenes de compra se imprimen, se firman, se escanean y se envían por correo. A veces el proveedor ni siquiera las firma.

La lógica de fondo es universal: **garantía de pago contra garantía de envío**.

### 2.2 Lo que hay hoy en wallets de agentes

**(a) Políticas fuera de la cadena (MPC, TEE, enclaves):** Coinbase, Cobo, Privy, Turnkey, Skyfire. La regla la hace cumplir el proveedor, no un contrato público que el usuario controle y audite.

**(b) Permisos en la cadena:** Safe + Zodiac Roles v2, MetaMask ERC-7715 con caveat enforcers (estándar aún en borrador), Crossmint. Granulares y auditables, pero sin capa de IA ni modelo de amenaza documental.

**(c) Rieles de tarjetas (Visa Intelligent Commerce, Mastercard Agent Pay, Google AP2, Stripe ACP):** resuelven comercio electrónico y dejan la regla en el emisor. No sirven para un pago entre empresas contra documentos de embarque.

### 2.3 El hueco

Pagos entre empresas condicionados a hechos verificables (orden firmada, embarque atestado), con la regla en un contrato que ambas partes pueden leer, operados por un agente que no puede desviar fondos aunque lo engañen.

**Por verificar antes del deck (D9):** qué plataformas de financiamiento de comercio exterior sobre blockchain y de BL electrónico existen hoy y cómo se comparan. No afirmar que "nadie lo hace".

---

## 3. Arquitectura

### 3.1 Billetera de la empresa: Safe + Zodiac Roles Modifier v2 + Delay Modifier

- Cada empresa opera desde su Safe. Los dueños son personas (por ejemplo 2 de 3 socios), nunca el agente.
- Rol del agente: solo puede llamar al contrato de escrow para depositar una orden ya firmada, con cupo por periodo. El único miembro del rol es PDRGate (D4): la llave del agente sola no mueve fondos.
- El Roles Modifier intercepta la llamada y valida destino, selector de cuatro bytes y argumentos contra las condiciones configuradas.
- El dueño del Roles Modifier es la Safe de la empresa, nunca el agente. Nada externo puede ampliar permisos (la lección Bankr).
- Los cambios de configuración (cupos, quién puede comprar, firmante de la política) pasan por el Delay Modifier, con espera y veto.
- Módulos auditados. No se escribe el control de permisos desde cero. Nota de diligencia: auditorías independientes ya identificaron y mitigaron una falla de trailing bytes padding en el desensamblador MultiSend del Roles Modifier; citarla en el informe demuestra que el equipo conoce la historia de seguridad de su propia base.
- **Abierto:** la red es cerrada y todavía no está elegida. Hay que confirmar que Safe y los módulos de Zodiac se pueden desplegar en ella y qué herramientas (SDK, servicios de transacciones) quedan disponibles.

### 3.2 Contrato de escrow (TradeEscrow)

Es la pieza nueva. Custodia los fondos de cada orden y solo los mueve por las transiciones de una máquina de estados:

1. `open`: registra una orden firmada con EIP-712 por importador y exportador.
2. `fund`: el importador deposita el total. Los fondos quedan bloqueados.
3. `releaseAdvance`: gatillo 1. Libera el anticipo a la cuenta de cobro firmada.
4. `submitShipment`: gatillo 2. Verifica la atestación firmada por la naviera, la fecha *on board*, que el BL no se haya usado y el PDR del motor. Libera el saldo.
5. `refundAfterDeadline`: pasada la fecha límite sin prueba de embarque, devuelve el saldo al importador.
6. `raiseDispute`, `resolve` y `cancel`: caminos laterales.

Invariantes, probadas con fuzz:

1. Lo pagado en total nunca supera lo depositado.
2. Ningún fondo sale hacia una dirección que no sea el importador o la cuenta de cobro de la orden.
3. Un estado final nunca vuelve a mover fondos.
4. Un mismo BL nunca liquida dos órdenes.

Structs, funciones, eventos y errores: sección 9 de [flujo_clave.md](flujo_clave.md) y sección 5.14 de [KEEL_SOLUCION_ALCANCE.md](KEEL_SOLUCION_ALCANCE.md).

### 3.3 Pipeline de documentos con extracción en cuarentena, versión honesta

- Un LLM en cuarentena, sin herramientas, lee el contenido no confiable (PDF del BL, de la factura, de la proforma) y solo puede devolver un JSON de esquema fijo, sin texto libre: números de documento, fechas, montos, puertos y códigos.
- Un parser determinista extrae los mismos campos. Si no coinciden, la operación queda retenida.
- No hay LLM operativo (D2). Lo que sigue al extractor es un motor determinista.
- Limitación reconocida y resuelta: el patrón dual LLM (Willison, 2023) protege el flujo de control pero no el flujo de datos, como documenta CaMeL (Google DeepMind y ETH Zurich, arXiv 2503.18813). Un extractor manipulado puede devolver un valor falso dentro de un esquema válido. Por eso la defensa decisiva no está en el esquema sino en tres hechos: la cuenta de cobro nunca proviene de un documento, la prueba de embarque es una firma de la naviera y no un PDF, y el contrato solo paga a las partes de la orden.
- **La IA no valida firmas.** Una firma escaneada es una imagen. Las firmas válidas son criptográficas.
- Límite declarado: los BL no tienen formato estándar entre navieras. El prototipo cubre los formatos del corpus, no cualquier BL.
- En el pitch se dice explícitamente: asumimos que la IA puede fallar, y demostramos que aun así el contrato rechaza.

### 3.4 Registro de Decisión de Política (PDR)

Adoptado del marco académico PACE (Policy-Attested Contract Execution, arXiv 2608.17220), cuyo axioma es el mismo de Keel: el LLM propone, el verificador dispone y la cadena hace cumplir.

Keel emite un PDR en dos momentos:

| Momento | Qué decide el motor | Quién lo verifica en la cadena |
|---|---|---|
| Depósito | Que la orden está firmada, el proveedor es conocido y el monto cabe en el cupo | PDRGate, antes de ejecutar por el Roles Modifier |
| Gatillo 2 | Que el BL y la factura coinciden con la orden y con la atestación de la naviera | TradeEscrow, en `submitShipment` |

Flujo por decisión:

1. El motor de reglas determinista (función pura, sin acceso al LLM ni a la red) valida la intención contra la política.
2. La llamada exacta se simula con `eth_call` (D7).
3. Se emite un PDR firmado con EIP-712 que enlaza: hash de la intención, versión de la política, entradas usadas y hash keccak256 del calldata exacto.
4. Cualquier divergencia de un byte entre lo aprobado y lo enviado invalida la ejecución.

En las evaluaciones del paper, PACE logró 0,00 de ejecuciones inseguras con 0% de falsos positivos sobre 2.800 ensayos. Implementar una versión de este registro convierte "tenemos reglas" en "tenemos un compromiso criptográfico verificable por transacción".

### 3.5 Niveles de permiso

| Nivel | Nombre | Qué cubre en comercio exterior | Ejecución |
|---|---|---|---|
| 0 | Leer | Leer documentos, mostrar el diff, proponer la orden, avisar | Sin transacción |
| 1 | Autónomo | Depositar una orden firmada con proveedor conocido y bajo el cupo; presentar el embarque; ejecutar el reembolso | Inmediata |
| 2 | Con espera | **Proveedor nuevo**, cambios de cupos, de roles o del firmante de la política | Delay Modifier: espera, aviso y veto |
| 3 | Cofirma | Depósitos sobre el cupo o fuera de rango | Exige al cosignatario |
| 4 | Prohibido | Cambiar la cuenta de cobro de una orden firmada, enviar fondos fuera del escrow, modificar roles | El rol del agente no lo permite |

Firmar la orden de compra, abrir una disputa y cancelar son siempre actos de personas.

El cosignatario puede aprobar o frenar, pero no puede iniciar envíos ni retirar hacia sí mismo. El árbitro de una disputa solo puede repartir entre importador y exportador. Quien frena no puede robar.

### 3.6 Bitácora con evidencia dura

Cada intento queda registrado con estado (ejecutado, retenido por el motor, revertido por el contrato), motivo, hash de los documentos de origen y hash de transacción cuando existe.

La joya probatoria: transacciones revertidas en la cadena, lanzadas deliberadamente. Por ejemplo, un `submitShipment` con una atestación que no firmó la naviera, o un intento de mover fondos de la Safe con la llave del agente hacia una dirección externa.

---

## 4. Qué se recorta y por qué

- **Pago de cuentas personales:** fuera. Era la propuesta anterior.
- **Integración con BL electrónico de navieras:** trabajo futuro. En el prototipo, la naviera es una llave de prueba registrada.
- **Identidad empresarial con credenciales verificables (WeIdentity o similar):** trabajo futuro. En el prototipo, un registro de partes administrado por Keel.
- **Bancos y rampas fiat:** trabajo futuro. Se responde con los tres modelos de liquidación de la sección 6.4 del documento de alcance.
- **Financiamiento:** lámina de trabajo futuro. Un tercero deposita a nombre del importador y cobra después.
- **Aduana, impuestos y flete:** Keel no los toca.
- **Compilador de mandato en lenguaje natural y efecto red de atestaciones (EAS):** fuera, igual que antes.

---

## 5. Demo en 4 actos, cada uno con hash real (propuesta)

1. **Flujo feliz:** importador y exportador firman la orden, el agente deposita, sale el anticipo, la naviera atesta el embarque, el motor confirma BL y factura, sale el saldo.
2. **Los dos fraudes documentales:** llega un correo de "cambio de cuenta" y un BL fabricado. Se muestra que el extractor lee la cuenta falsa (la IA falla) y que nada cambia: la cuenta de cobro está firmada en la orden, y el BL sin firma de la naviera revierte.
3. **El proveedor no embarca:** pasa la fecha límite y el saldo vuelve al importador, sin depender de nadie.
4. **El robo directo:** con la llave del agente se intenta enviar fondos de la Safe a una dirección externa. El Roles Modifier revierte. Hash del revert en pantalla.

Cierre: tabla con N órdenes liquidadas, M ataques bloqueados, 0 fondos perdidos.

---

## 6. Alineación con WeBank

- Estrategia de banco nativo de IA (declarada en marzo de 2025, más de 800 agentes internos al cierre de 2025) con humano en el circuito: Keel es autonomía con veto humano estructural.
- Patrón de ganadores del FinTechathon: en 2025 ganó un motor que convierte lenguaje natural en estrategias ejecutables; en 2024 los premios de blockchain fueron supervisión y confianza para IA sobre FISCO BCOS.
- **Red cerrada:** el corredor objetivo es Chile con Hong Kong sobre una red permisionada, con participantes identificados. FISCO BCOS, la cadena de consorcio que impulsa WeBank, es compatible con EVM y es la candidata natural. La elección está abierta.
- **Identidad:** WeIdentity, la solución de WeBank sobre FISCO BCOS, es el camino a producción para vincular cada billetera con una empresa verificada.
- **Hong Kong:** aprobó en 2025 un régimen de licencias para emisores de stablecoins, y WeBank tiene operación ahí. En China continental el comercio con criptomonedas está prohibido desde 2021. Por verificar antes del deck.
- KYC, KYB y AML/KYT como trabajo futuro, en el idioma del banco.
- Frase para el jurado: "Keel no reemplaza al banco; hace que el pago solo ocurra cuando se cumplen condiciones verificables, sea cual sea el riel de pago."

---

## 7. Informe de seguridad (30% del puntaje)

Matriz de amenazas, cada una con control y riesgo residual:

| Amenaza | Control | Riesgo residual |
|---|---|---|
| Cambio de cuenta por correo | La cuenta de cobro va firmada por ambas partes en la orden | Ingeniería social para que ambas partes firmen una orden nueva |
| BL falso | Solo vale la atestación firmada por la naviera fijada en la orden | Llave de la naviera robada |
| Prompt injection en un documento (OWASP LLM01) | Extractor sin herramientas, esquema sin texto libre, concordancia con el parser | El extractor puede devolver valores falsos; los frenan la firma de la naviera y el contrato |
| Agencia excesiva (OWASP LLM06) | Rol Zodiac limitado al escrow, con cupo | Acciones dentro del rol siguen siendo posibles |
| Robo de la llave del agente o del relayer | Sin un PDR válido no pasa por PDRGate | Ninguna autoridad propia; puede gastar gas |
| Robo de la llave de política | El Roles limita destino y cupo; el escrow solo paga a las partes | Puede depositar órdenes firmadas dentro del cupo y aprobar documentos no conformes |
| Mismo BL para dos órdenes | Registro de BL usados en el contrato | Depende de normalizar bien el número |
| Importador retira tras el embarque | El contrato no tiene retiro unilateral | Disputa de mala fe, que resuelve el árbitro |
| Exportador nunca embarca | Reembolso del saldo por vencimiento | El anticipo solo se recupera por disputa |
| Colusión de exportador y naviera | Ventana de disputa, árbitro, partes registradas | Riesgo residual declarado |
| Árbitro corrupto | Solo puede repartir entre las partes | Reparto injusto; opción de exigir 2 de 3 |
| Evento externo que amplía permisos (estilo Bankr) | Solo la Safe gobierna los módulos, por el Delay | Compromiso de la propia Safe |
| Repetición de firmas | EIP-712 con red, contrato, orden y nonce | Ninguna identificada en el diseño; lo demuestran las pruebas |
| Caída o degradación del LLM | El motor determinista no depende del LLM | Las operaciones se retienen y se avisa |

Riesgos declarados con honestidad: el contrato de escrow es código propio sin auditoría; la naviera del prototipo es una llave de prueba; el registro de partes lo administra Keel; el token de pago tiene riesgo de emisor; en una red cerrada la verificación pública depende de quién tenga acceso a ella; la bitácora prueba lo que el sistema registró, no que nada se haya escapado.

---

## 8. Métricas del red team

Batería de 30 a 50 escenarios documentados: cambio de cuenta, BL fabricado, BL repetido, fecha *on board* alterada, monto de factura alterado, injection en documentos, urgencia y falsa autoridad, llaves robadas, intentos de retiro fuera de la máquina de estados.

- Tasa de bloqueo de ataques.
- Tasa de falsos positivos sobre documentos legítimos.
- Porcentaje de órdenes completadas sin intervención humana más allá de las firmas.
- Latencia de decisión.
- Capa que detuvo cada ataque.

Resultados publicados en el repositorio como red team abierto.

---

## 9. Stack

| Componente | Tecnología |
|---|---|
| Cuenta de la empresa | Safe |
| Permisos del agente | Zodiac Roles Modifier v2 |
| Espera y veto de cambios | Zodiac Delay Modifier |
| Escrow | Contrato TradeEscrow (Solidity, Foundry) |
| Red | Red cerrada compatible con EVM, por definir |
| Token de pago | Stablecoin disponible en esa red, por definir |
| Cliente blockchain | viem sobre Node.js |
| Simulación | `eth_call` en ejecución; Anvil solo para pruebas |
| Registro de decisión | PDR firmado con EIP-712 (inspirado en PACE) |
| Lectura de documentos | Parser determinista más LLM en cuarentena |
| Aplicación | React Native con Expo |
| Canal de avisos | Bot de Telegram |

---

## 10. Plan

El reparto por áreas, las tareas y el calendario están en [keel_division_trabajo.md](keel_division_trabajo.md).

Regla de recorte: nunca caen el contrato de escrow con sus invariantes, la firma de la orden, la atestación de embarque firmada, los 4 actos de la demo ni el informe de seguridad.

---

## 11. Pendientes urgentes

Correo a la organización (wangyr@pbcsf.tsinghua.edu.cn):

1. ¿Las transacciones en una red cerrada o de prueba cuentan como "real on-chain transaction hashes"? El jurado necesita poder verificarlas, así que hay que definir cómo accede a la red o al explorador.
2. Conflicto de fechas: las bases indican cierre el 20 de octubre, pero la página de IEEE CIS Shenzhen publica una cronología tentativa con cierre preliminar el 2 de noviembre. Planificar para el 20 y confirmar; no contar con la holgura.
3. Composición del equipo: 2 a 5 integrantes, al menos 60% no chinos.

Decisiones internas: las de la sección 14 de [flujo_clave.md](flujo_clave.md), empezando por la red y el token.

---

## Anexo A: material técnico de respaldo (para preguntas del jurado)

### A.1 Enclaves TEE (trabajo futuro declarado)

El extractor en cuarentena protege el contenido, pero el servidor donde corre el agente sigue siendo superficie de ataque: exfiltración de la llave de política o manipulación del proceso por el sistema operativo o el proveedor de nube. La mitigación de estado del arte es encerrar la inferencia y las credenciales en un enclave de ejecución confiable con atestación criptográfica de código, como el framework dstack de Phala Network sobre procesadores Intel TDX. Se declara como trabajo futuro en el informe.

### A.2 Por qué no Smart Sessions (ERC-7579)

Si un juez pregunta por qué no se usaron cuentas modulares ERC-4337/7579 con Smart Sessions (Rhinestone/Biconomy): las políticas canónicas como ERC20SpendingLimitPolicy solo validan los selectores estándar (transfer, transferFrom, approve, increaseAllowance). El agente de Keel no hace transferencias directas: llama a funciones de un contrato de escrow, y necesita condiciones por parámetro sobre esas llamadas. El Roles Modifier de Zodiac, con inspección profunda de calldata, cubre ese caso con módulos ya auditados. Además, ERC-7715 sigue en borrador.

### A.3 Comparación con los análogos más cercanos

| Dimensión | Keel | Lit Protocol (Vincent) | Marco PACE (académico) |
|---|---|---|---|
| Entrada | Orden de compra firmada por ambas partes | Selección de habilidades delegadas con políticas programadas | Política declarativa formalizada |
| Verificación | Motor determinista off-chain más simulación | Código JavaScript inmutable en IPFS auditado por nodos Lit | Función determinista pura sin acceso al LLM |
| Compromiso criptográfico | Módulos Zodiac, PDR, atestación de la naviera y bitácora | Firma distribuida (DKG) en nodos TEE condicionada a la política | PDR con hash de calldata |
| Ejecución on-chain | Safe verificada por Roles v2 y Delay, más un contrato de escrow | Cuenta PKP con delegación de firma | Smart account con verificación de firma PDR |
| Autonomía | 5 niveles estratificados (0 a 4) | Delegación binaria por habilidad | Permiso condicionado: ejecución válida o reversión |

Keel combina la base auditada de Zodiac con el rigor probatorio de PACE y agrega lo que ninguno tiene: pagos condicionados a hechos del comercio exterior, con la cuenta de cobro y la prueba de embarque fuera del alcance de la IA.

### A.4 Incidentes citables en el pitch

- **Freysa (nov 2024):** 13,19 ETH (unos 47 mil dólares) extraídos por ingeniería social en el intento 482.
- **AIXBT (mar 2025):** 55,5 ETH; el desarrollador atribuye el ataque a acceso a infraestructura, no al agente.
- **Grok/Bankrbot (may 2026):** el caso central. Primero un NFT amplió los permisos de la wallet, luego una instrucción en código Morse decodificada por Grok ejecutó el drenaje. Entre 150 y 200 mil dólares según OECD AI Incidents Monitor, unos 175 mil según SlowMist. MetaMask lo calificó como el primer exploit documentado de su tipo. Cerca del 80% se recuperó después.
- **Zscaler (vía SecurityWeek):** sitios con prompts ocultos que piden a agentes pagar en cripto para obtener una API key.
- No usar sin confirmar: la supuesta vulnerabilidad de Coinbase AgentKit (abril 2026) solo aparece en una fuente de baja calidad.
- Falta un caso citable de fraude por cambio de cuenta en comercio exterior, con fuente. Por buscar.

### A.5 Contexto de comercio exterior (para la narrativa de impacto)

De la entrevista con el importador ([reunion_comercio_exterior.md](reunion_comercio_exterior.md)):

- Dos casos reales documentados: un repuesto aéreo desde Alemania (orden, anticipo por SWIFT y embarque en 11 días) y agar por vía marítima con pago a 30 días desde el embarque.
- El BL es título de propiedad de la carga y la fecha *on board* es el dato crítico.
- El entrevistado considera la idea vigente: hay mucho papel por automatizar y agencias de aduana ya exploran algo similar.
- Su conocimiento es del caso chileno. Lo que ocurre del lado del exportador en China o Hong Kong está por validar.

### A.6 Trabajo futuro (mencionar, no construir)

BL electrónico de navieras; identidad con WeIdentity o KYA; bancos como riel de liquidación y como financistas; depósitos tokenizados; KYT/AML; enclaves TEE (A.1); pago diferido a N días del embarque; otros corredores y la exportación desde Chile; recuperación social de la Safe; auditoría externa.
