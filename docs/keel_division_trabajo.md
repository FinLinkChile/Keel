# Keel: división del trabajo en 5 áreas

**Proyecto:** Keel, agent wallet que paga solo cuando se cumplen condiciones verificables. Tiene dos modos sobre la misma billetera: **Keel Personal** (pago de cuentas recurrentes de una persona) y **Keel Trade** (órdenes de compra internacionales con un contrato de escrow)
**Competencia:** 2026 Shenzhen FinTechathon, International Track, Topic F: Agent Wallet
**Cierre:** martes 20 de octubre, 23:59 hora de Beijing, que en Chile es **martes 20 a las 12:59**. Planificamos entregar el **lunes 19 a las 22:00** (hora de Chile) y dejar el martes como margen.
**Lema:** la IA interpreta una vez, el contrato obedece siempre.

**Cambio de rumbo (13 de octubre de 2026):** el foco del proyecto pasó del pago de cuentas al flujo de escrow aplicado a la importación de productos desde China por empresas chilenas, con el corredor Chile y Hong Kong como objetivo, sobre una red cerrada. El objetivo y el flujo están en [flujo_clave.md](flujo_clave.md), que manda si hay diferencias. Keel Trade es el modo principal y la demo.

**Keel Personal vuelve al alcance (13 de octubre):** el pago de cuentas queda como segundo modo. Por eso este documento reúne las dos listas de tareas:

- **Base (Personal):** las tareas definidas antes del cambio de rumbo. Se mantienen con su número y su contenido original.
- **Agregado por Trade:** lo que el cambio de rumbo suma. Cuando una tarea existe en los dos modos, conserva un solo número y su texto separa qué pide cada modo. Las tareas que solo existen en Trade tienen números nuevos y dicen "agregada por Trade".
- Ninguna tarea queda retirada: T2.3 (tipo de cambio) vuelve a aplicar, solo para Personal.
- Todo lo posterior al lunes 12 es una **propuesta** que confirma el equipo: las interfaces el Área 2, el calendario el Área 5. La profundidad con que Personal entra en la entrega es la decisión abierta 14 de [flujo_clave.md](flujo_clave.md).

---

## 0. Cómo leer este documento

1. **Decisiones transversales** (sección 1): lo que ya se definió y nadie cambia sin avisar al equipo.
2. **Interfaces compartidas** (sección 2): estructuras que se congelan para que las 5 áreas trabajen en paralelo sin bloquearse.
3. **Las 5 áreas** (secciones 3 a 7): objetivo, entregables, tareas detalladas, criterio de "listo", dependencias y qué se recorta si falta tiempo.
4. **Calendario, integración y reglas de recorte** (secciones 8 a 10).
5. **Mapa de críticas** (sección 11): cada crítica recibida, con el área y la tarea que la resuelve.

Las críticas 1 a 7 no venían en la captura revisada; el mapa cubre de la 8 a la 19.

---

## 1. Decisiones transversales (válidas para todas las áreas)

| # | Decisión | Por qué |
|---|---|---|
| D1 | El proyecto se llama **Keel** en código, documentos, repositorio y deck. No queda ninguna mención a "Leash". | Hay un repositorio competidor del mismo tema con ese nombre. |
| D2 | **No hay LLM operativo.** El flujo queda así: extractor LLM en cuarentena, validador determinista, motor de política, PDR, contrato. Si existe un chat, es de solo lectura (nivel 0) y explica decisiones con plantillas. | Crítica 8: el motor ya es determinista y ese LLM solo agrega superficie de ataque. |
| D3 | **El esquema de extracción no tiene texto libre.** Solo enums, números y campos validados con expresiones regulares. | Crítica 8. |
| D4 | **PDRGate es el único miembro del rol del agente** en el Roles Modifier. La llave del agente sola no puede mover fondos: solo sirve para pagar gas. | Sin esto, el PDR no se exige en cadena. |
| D5 | **Los cambios de configuración pasan por el Delay Modifier:** lista blanca de beneficiarios (Personal), proveedores conocidos (Trade), cupos, firmante de la política y miembros de roles. Tienen aviso y ventana de veto. | Hace verificable el nivel 2 y responde a la crítica 16. |
| D6 | **El cosignatario no es dueño de la Safe.** Tiene un rol propio que solo le permite vetar, pausar y revocar el rol del agente. | Crítica 15: en una Safe, cualquier dueño puede proponer. |
| D7 | **La simulación en tiempo de ejecución es `eth_call`.** Anvil se usa solo para las pruebas. | Crítica 18. |
| D8 | **Fallar cerrado siempre avisa:** todo pago u operación retenida notifica el motivo, la fecha límite y la alternativa manual. | Crítica 19. |
| D9 | **Nada de sobreafirmaciones.** Ninguna celda dice "ninguno conocido" ni "imposible para cualquiera". Cada afirmación de seguridad dice para quién vale, dónde se hace cumplir y qué prueba lo demuestra. | Crítica 16. |
| D10 | Todo lo que se entrega al jurado va en inglés. El trabajo interno puede ir en español. | Bases del concurso. |
| D11 | **El objetivo del proyecto es el flujo de [flujo_clave.md](flujo_clave.md).** Se consulta antes de idear o crear un componente. | Cambio de rumbo del 13 de octubre. |
| D12 | **La cuenta de cobro nunca sale de un documento.** En Trade sale de la orden de compra firmada por ambas partes, y cambiarla exige una orden nueva. En Personal sale de la tabla de beneficiarios registrados, y cambiarla pasa por el Delay. | Es la defensa contra el fraude de cambio de cuenta. |
| D13 | **La prueba de embarque es una firma de un tercero, no un PDF.** La IA lee datos, no valida firmas. (Trade) | Una firma escaneada es una imagen. |
| D14 | **Quien frena o arbitra no puede cobrar.** El contrato de escrow solo paga al importador o a la cuenta de cobro de la orden. (Trade) | Extiende D6 al árbitro. |

---

## 2. Interfaces compartidas (propuesta, se congelan el miércoles 14 a las 20:00)

El Área 2 es dueña de estas definiciones. Viven en `schemas/`, como JSON Schema y tipos TypeScript (zod), y como structs en Solidity. Cambiarlas después del congelamiento exige avisar a las 5 áreas.

Las interfaces de Personal (`InvoiceExtraction`, `PaymentIntent`) se congelaron el lunes 12 y se mantienen. Las de Trade se agregan y se congelan el miércoles 14. `PolicyDecision` es común a los dos modos.

### 2.1 Extracción de documentos (salida del extractor en cuarentena)

**Personal (base).** Factura de una cuenta recurrente:

```json
{
  "alias_id": "ARRIENDO | LUZ | INTERNET | GASTOS_COMUNES",
  "issuer_tax_id": "RUT normalizado, sin puntos ni guion, regex ^[0-9]{7,8}[0-9K]$",
  "invoice_number": "regex ^[0-9]{1,12}$",
  "period": "regex ^20[0-9]{2}(0[1-9]|1[0-2])$",
  "amount_clp": "entero positivo",
  "due_date": "timestamp unix",
  "mentions_account_change": "boolean",
  "hidden_text_detected": "boolean"
}
```

No hay campo de nombre del emisor, notas ni dirección de destino. El nombre visible del beneficiario sale de la tabla de alias registrada en el onboarding, nunca de la factura.

**Trade (agregado).** Documento de transporte:

```json
{
  "doc_type": "BILL_OF_LADING | AIR_WAYBILL",
  "document_number": "regex ^[A-Z0-9]{6,20}$",
  "on_board_date": "timestamp unix",
  "port_of_loading": "UN/LOCODE, regex ^[A-Z]{2}[A-Z0-9]{3}$",
  "port_of_discharge": "UN/LOCODE, regex ^[A-Z]{2}[A-Z0-9]{3}$",
  "hidden_text_detected": "boolean"
}
```

Factura comercial:

```json
{
  "invoice_number": "regex ^[A-Z0-9]{1,20}$",
  "order_number": "regex ^[A-Z0-9]{1,20}$",
  "amount_minor": "entero positivo, en la unidad mínima de la moneda",
  "currency": "USD | EUR | CNY | HKD",
  "incoterm": "EXW | FOB | CIF | CFR",
  "importer_tax_id": "RUT normalizado, regex ^[0-9]{7,8}[0-9K]$",
  "hs_code": "código arancelario, regex ^[0-9]{6,10}$",
  "mentions_account_change": "boolean",
  "hidden_text_detected": "boolean"
}
```

No hay nombres, descripciones, notas, datos bancarios ni direcciones de destino. Lo que se muestra a las personas (nombre del proveedor, cuenta de cobro) sale de la orden firmada y del registro de partes, nunca del documento.

### 2.2 Intenciones, orden de compra y atestación de embarque

**Personal (base).** Intención de pago:

```solidity
struct PaymentIntent {
    uint8   aliasId;        // enum de beneficiarios registrados
    address recipient;      // resuelto desde la tabla de alias, nunca desde el documento
    uint256 amountUsdc;     // 6 decimales
    bytes32 invoiceKey;     // keccak256(issuerTaxId, invoiceNumber, period)
    uint64  deadline;
    uint256 nonce;
}
```

**Trade (agregado).** Orden de compra, atestación de embarque e intención de depósito:

```solidity
struct PurchaseOrder {
    bytes32 orderId;
    address importer;
    address exporter;
    address payoutAddress;      // firmada por ambos; nunca sale de un documento
    address token;
    uint256 totalAmount;
    uint16  advanceBps;         // 5000 = 50%
    uint64  shipmentDeadline;
    uint64  disputeWindow;
    address carrier;
    address arbiter;
    bytes32 incoterm;
    bytes32 termsHash;
    bytes32 requiredDocsHash;
    uint256 nonce;
}

struct ShipmentAttestation {
    bytes32 orderId;
    bytes32 blNumberHash;
    uint64  onBoardDate;
    bytes32 portOfLoading;
    bytes32 docsHash;
}

struct FundIntent {
    bytes32 orderId;
    address escrow;         // el contrato TradeEscrow
    address token;
    uint256 amount;         // igual al totalAmount de la orden
    uint64  deadline;
    uint256 nonce;
}
```

El detalle de cada campo de la orden y de la atestación está en las secciones 5.5 y 5.8 de [KEEL_SOLUCION_ALCANCE.md](KEEL_SOLUCION_ALCANCE.md).

### 2.3 Decisiones (PDR de Keel)

**Común a los dos modos:**

```solidity
struct PolicyDecision {
    bytes32 intentHash;     // hash EIP 712 de PaymentIntent (Personal) o de FundIntent (Trade)
    bytes32 calldataHash;   // keccak256 del calldata exacto que ejecuta la Safe
    bytes32 policyHash;     // versión vigente de las reglas
    bytes32 inputsHash;     // Personal: tipo de cambio, fuentes, versión de lista blanca
                            // Trade: orden, registro de proveedores, cupo usado
    uint8   tier;           // 1 o 3 (los niveles 0, 2 y 4 no llegan al gate)
    uint64  expiresAt;
}
```

**Trade (agregado):**

```solidity
struct DocumentDecision {
    bytes32 orderId;
    bytes32 attestationHash; // hash EIP 712 de ShipmentAttestation
    bytes32 docsHash;        // hash del paquete de documentos leído
    bytes32 policyHash;
    bytes32 inputsHash;      // extracciones del BL y de la factura
    uint64  expiresAt;
}
```

* Dominio EIP 712: `name = "Keel"`, `version = "1"`, `chainId`, y como `verifyingContract` el contrato que verifica cada firma (PDRGate para `PolicyDecision`, TradeEscrow para la orden, la atestación y `DocumentDecision`).
* El PDR completo, en JSON con las reglas evaluadas y sus resultados, se guarda fuera de cadena en `evidence/pdr/<hash>.json`. En cadena va su hash.
* **Abierto:** cómo acepta PDRGate las dos intenciones (`PaymentIntent` y `FundIntent`): un gate con dos entradas o un gate por modo. Lo deciden las Áreas 1 y 2 antes del congelamiento.
* **Abierto:** qué firmante de política acepta el escrow para `DocumentDecision` (uno registrado en el contrato o uno fijado en cada orden) y si esa decisión es obligatoria para liberar el saldo.

### 2.4 Eventos y errores tipados (nombres fijos)

**Personal (base):**

* PDRGate, eventos: `PaymentExecuted`, `PaymentHeld`, `BeneficiaryChangeQueued`, `BeneficiaryChangeVetoed`, `AgentRoleRevoked`, `GatePaused`.
* PDRGate, errores: `IntentMismatch`, `CalldataMismatch`, `BadPolicySignature`, `MissingCosignature`, `StalePolicy`, `Expired`, `NonceUsed`, `InvoiceAlreadyPaid`, `GateIsPaused`.

**Trade (agregado):**

* PDRGate, eventos: `FundingExecuted`, `OperationHeld`. Los errores son los mismos, salvo `InvoiceAlreadyPaid`, que no aplica.
* TradeEscrow, eventos: `OrderOpened`, `OrderFunded`, `AdvanceReleased`, `ShipmentAccepted`, `BalanceReleased`, `Refunded`, `DisputeRaised`, `DisputeResolved`, `OrderCancelled`.
* TradeEscrow, errores: `InvalidState`, `OrderExists`, `BadImporterSignature`, `BadExporterSignature`, `BadCarrierSignature`, `BadDocumentDecision`, `ShipmentTooLate`, `BillOfLadingAlreadyUsed`, `DeadlineNotReached`, `NotParty`, `BadResolution`, `TokenNotAllowed`, `AmountMismatch`.

### 2.5 Estructura del repositorio

```
contracts/   Solidity, Foundry, scripts de despliegue                        (Área 1)
schemas/     JSON Schema, tipos TS, structs EIP 712                           (Área 2)
engine/      motor de política, PDR, firmas, verificador                      (Área 2)
ingest/      recepción de documentos y correo, parser, extractor              (Área 3)
app/         tipos de cuenta, perfiles, firma, diff legible, cosignatario     (Área 4)
bot/         bot de Telegram con plantillas                                   (Área 4)
redteam/     escenarios, corpus adversarial, métricas                         (Área 5)
docs/        objetivo, documento técnico, seguridad, deck                     (Área 5)
evidence/    PDR y evidencia en cadena                                        (Área 5)
```

---

## 3. Área 1: Contratos y permisos en cadena

**Perfil sugerido:** quien tenga más experiencia en Solidity y Foundry.
**Objetivo:** que ni la IA, ni la llave del agente, ni el motor de política comprometido puedan pagar a quien no corresponde, y que cada nivel de permiso tenga una regla en cadena con su prueba. En Trade, además, que los fondos de una orden solo puedan ir al exportador o volver al importador, según las condiciones firmadas.

### Entregables

* Safe, Roles Modifier v2, Delay Modifier y PDRGate desplegados en la red elegida.
* TradeEscrow desplegado en la misma red (Trade).
* Batería de pruebas negativas, con fuzz e invariantes.
* `contracts/deployments/<chainId>.json` con todas las direcciones.
* Tabla "nivel → dónde se hace cumplir → prueba", que se entrega al Área 5.

### Tareas

**T1.0 Red y token (agregada por Trade, bloquea el resto).**
Elegir con el equipo la red cerrada y el token de pago. Confirmar que Safe y los módulos de Zodiac se pueden desplegar ahí y qué herramientas quedan disponibles (SDK, explorador). Si la red no tiene una stablecoin, desplegar un token de prueba y declararlo. Si Safe o Zodiac no se pueden desplegar, avisar el mismo día: cambia el diseño de permisos.

Personal se diseñó sobre Base Sepolia con USDC. Esta tarea decide también si Personal corre en la misma red que Trade o se queda en la original.

**T1.1 Safe base.**
* **Personal (base):** desplegar una Safe con el dueño como único firmante (1 de 1) para la demo. Documentar que en producción sería 2 de 3, con recuperación social.
* **Trade (agregado):** desplegar una Safe para el importador y otra para el exportador. En la demo pueden ser 1 de 1; documentar que en producción serían 2 de 3 socios.
* En los dos modos, el cosignatario **no** se agrega como dueño (D6).

**T1.2 Rol AGENTE en el Roles Modifier.**
Común a los dos modos:
* Miembro único: la dirección de PDRGate (D4).
* Condición sobre el monto: dentro de un cupo (allowance) por periodo, por ejemplo mensual, con recarga automática.
* Opciones de ejecución: sin `delegatecall` y sin `value`.
* Armar la configuración con el SDK de Zodiac Roles para no escribir a mano la codificación de condiciones. Guardarla como archivo versionado: su hash es la parte en cadena del `policyHash`.

**Personal (base):**
* Destino permitido: solo el contrato del token de pago.
* Función permitida: solo `transfer(address,uint256)`.
* Condición sobre el destinatario: igual a alguna dirección de la lista blanca vigente.

**Trade (agregado):**
* Destinos permitidos: el contrato TradeEscrow y el token de pago.
* Funciones permitidas: `fund(orderId)` en el escrow, y en el token solo la aprobación necesaria para ese depósito, con `spender` igual al escrow. Nunca `transfer` ni aprobaciones a otra dirección.
* **Abierto:** aprobación exacta más `fund`, o `fundWithPermit` si el token lo soporta.

Cada Safe lleva la configuración de su modo: la Safe de una persona no tiene permiso sobre el escrow, y la de una empresa no tiene `transfer` a una lista blanca.

**T1.3 Rol COSIGNATARIO en el Roles Modifier.**
* Miembro: la llave del cosignatario.
* Funciones permitidas y nada más:
  * vetar un cambio en cola (invalidar la transacción pendiente en el Delay Modifier);
  * revocar la membresía de PDRGate en el rol AGENTE (botón de pánico);
  * pausar PDRGate.
* Con esto, "el cosignatario no puede iniciar envíos" pasa a ser cierto a nivel de protocolo, no solo de interfaz (crítica 15).

**T1.4 Delay Modifier para cambios de configuración.**
* Habilitarlo como módulo de la Safe.
* Todo cambio de lista blanca (Personal), proveedores conocidos (Trade), cupos, firmante de política y membresías se encola ahí, con un enfriamiento de 3 minutos en la demo y 48 horas en el documento de producción, más una ventana de expiración.
* Definir con el Área 4 cómo el dueño propone el cambio desde su billetera.
* Este es el **nivel 2** en cadena.

**T1.5 ConfigGuard (prioridad media, se recorta si falta tiempo).**
* Guard de transacciones de la Safe que rechaza llamadas directas del dueño hacia Roles, Delay y PDRGate. Así, esos cambios solo pueden llegar por el camino del Delay.
* Sin este guard, el dueño puede saltarse el retraso, y eso **debe declararse** en el informe de seguridad (D9, crítica 16).
* Probar a fondo: un guard defectuoso puede bloquear la Safe. Incluir una prueba de que el dueño todavía puede operar por el camino legítimo.

**T1.6 Contrato PDRGate.**
`execute(intent, PolicyDecision d, bytes sigPolicy, bytes sigCosigner)` hace, en este orden:
1. Rechaza si está pausado (`GateIsPaused`).
2. Recalcula el hash EIP 712 de la intención y lo compara con `d.intentHash` (`IntentMismatch`).
3. Construye el calldata **dentro del contrato** a partir de la intención y compara su hash con `d.calldataHash` (`CalldataMismatch`).
4. Verifica que `sigPolicy` venga del firmante de política registrado (`BadPolicySignature`).
5. Verifica `d.policyHash == currentPolicyHash` (`StalePolicy`).
6. Verifica expiración y fecha límite (`Expired`).
7. Verifica y consume el nonce (`NonceUsed`).
8. Si `d.tier == 3`, exige una firma válida del cosignatario sobre el mismo digest (`MissingCosignature`). Así se implementa el umbral por monto que la Safe no tiene (crítica 15).
9. Ejecuta a través del Roles Modifier con el rol AGENTE. Los límites de Roles se siguen aplicando aunque todo lo anterior pase: es la defensa en profundidad.
10. Emite el evento del modo.

**Personal (base):** la intención es `PaymentIntent`. El calldata es `abi.encodeCall(IERC20.transfer, (intent.recipient, intent.amountUsdc))`. Antes de ejecutar, verifica y marca `invoiceKey` como pagada (`InvoiceAlreadyPaid`): la idempotencia queda en cadena, así que ni un motor comprometido puede pagar dos veces la misma factura (crítica 11). Emite `PaymentExecuted(intentHash, pdrHash, tier, invoiceKey)`. Este gate ya tiene código y pruebas locales.

**Trade (agregado):** la intención es `FundIntent`. El calldata es la llamada de depósito al escrow. La idempotencia queda en el escrow: una orden solo se deposita una vez (`InvalidState`). Emite `FundingExecuted(intentHash, pdrHash, tier, orderId)`.

`setPolicySigner` y `setPolicyHash` solo pueden llamarse desde la Safe, y solo por el camino del Delay (T1.4). Si es un gate con dos entradas o un gate por modo es una decisión abierta (sección 2.3).

**T1.7 Batería de pruebas negativas (crítica 14).**
Con Foundry y la configuración real de Roles. Cada caso debe revertir con el error esperado.

Comunes y de Personal (base):

| Grupo | Casos |
|---|---|
| Rol mal usado | `delegatecall`; `value` mayor que cero; otro token; `approve`; `transferFrom`; `increaseAllowance`; destinatario fuera de la lista; monto sobre el cupo del periodo |
| MultiSend | Llamadas empaquetadas con relleno al final (la falla conocida del desensamblador); llamada anidada al Roles Modifier |
| Escalada | Agente que intenta cambiar la configuración de Roles; agente que intenta asignarse roles; cosignatario que intenta transferir; cosignatario que intenta cambiar la lista |
| PDR | Calldata distinto del aprobado; intención alterada en un byte; firma de otro firmante; política vieja; PDR expirado; nonce repetido; factura ya pagada; nivel 3 sin cosignatario |
| Pausa y pánico | Pago con el gate en pausa; pago después de revocar el rol |

Dos propiedades fuzz de Personal:
* Para cualquier secuencia de llamadas del agente, la salida del periodo es menor o igual al cupo.
* Ninguna secuencia transfiere a una dirección fuera de la lista.

Agregados por Trade:

| Grupo | Casos |
|---|---|
| Rol mal usado | `transfer` directo; aprobación a otra dirección; llamada a otro contrato |
| Pausa y pánico | Depósito con el gate en pausa; depósito después de revocar el rol |
| Escrow, apertura | Firma del importador o del exportador inválida; orden repetida; naviera o árbitro igual a una de las partes; token no permitido; fecha límite pasada |
| Escrow, fondos | Depósito de quien no es el importador; monto distinto del total; segundo depósito de la misma orden; anticipo dos veces |
| Escrow, embarque | Atestación firmada por otra llave; atestación de otra orden; fecha *on board* posterior a la límite; BL ya usado; decisión de documentos inválida; embarque con disputa abierta |
| Escrow, cierre | Reembolso antes de la fecha límite; reembolso tras liquidar; resolución cuya suma no es el saldo; resolución sin firma del árbitro; cualquier llamada sobre un estado final |

**T1.8 Despliegue y verificación.**
Script de despliegue reproducible y un archivo de direcciones que consumen las demás áreas.
* **Personal (base):** contratos verificados en el explorador de la red; coordinar con el Área 5 la cuenta de faucet y los fondos de prueba.
* **Trade (agregado):** coordinar con el Área 5 cómo el jurado puede verificar las transacciones en una red cerrada.

**T1.9 Contrato TradeEscrow (agregada por Trade, es su pieza central).**
Implementar la máquina de estados y la interfaz de la sección 5.14 de [KEEL_SOLUCION_ALCANCE.md](KEEL_SOLUCION_ALCANCE.md): `open`, `fund`, `releaseAdvance`, `submitShipment`, `refundAfterDeadline`, `raiseDispute`, `resolve`, `cancel`.
* Verificación de firmas EIP 712 de importador, exportador, naviera y árbitro, con soporte de ERC-1271 para que firmen Safes.
* Depósito exacto, comparando el saldo antes y después.
* Patrón checks, effects, interactions y guard de reentrancia. Solo tokens permitidos.
* Plazos en días u horas, con margen de gracia antes del reembolso.
* Decisiones que hay que cerrar antes de escribir: anticipo en la misma transacción del depósito, ventana de disputa por defecto, resolución por árbitro solo o 2 de 3.

**T1.10 Invariantes del escrow con fuzz (agregada por Trade).**
1. Lo pagado en total nunca supera lo depositado.
2. Ningún fondo sale hacia una dirección que no sea `importer` o `payoutAddress`.
3. Un estado final nunca vuelve a mover fondos.
4. Un mismo BL nunca liquida dos órdenes.

**T1.11 Registro de partes (agregada por Trade, se recorta si falta tiempo).**
`PartyRegistry` administrado por Keel: `open` exige que importador, exportador, naviera y árbitro estén registrados. En la demo, la naviera y el árbitro son llaves de prueba, y se declara.

### Listo cuando

* Las pruebas de T1.7 pasan con `forge test`: al menos 25 casos negativos y 2 propiedades fuzz de Personal, y al menos 30 casos negativos de Trade.
* Las 4 invariantes de T1.10 pasan.
* Existe al menos un revert real en la red elegida por cada error tipado del gate y del escrow que se use en la demo.
* El Área 5 tiene la tabla de niveles y dónde se hace cumplir cada uno.

### Dependencias

* Necesita las estructuras de la sección 2 (Área 2), congeladas el miércoles 14.
* Entrega direcciones a las Áreas 2, 4 y 5 el jueves 15.

### Si falta tiempo

Se recorta en este orden: ConfigGuard (se declara el riesgo), recuperación social, registro de partes (queda una lista fija en el despliegue), liberación diferida por ventana de disputa, `fundWithPermit`, resolución 2 de 3. **Nunca** se recortan PDRGate, el rol AGENTE, la batería negativa, TradeEscrow con sus cuatro invariantes ni el reembolso por vencimiento.

---

## 4. Área 2: Motor de política, PDR, tipo de cambio y claves

**Perfil sugerido:** backend en TypeScript con interés en criptografía.
**Objetivo:** convertir una factura validada (Personal), o una orden firmada y unos documentos leídos (Trade), en decisiones deterministas, reproducibles y firmadas, que los contratos puedan verificar. Además, ser dueño de las interfaces y de la custodia de llaves.

### Entregables

* `schemas/` con las interfaces de Personal congeladas el lunes 12 y las de Trade el miércoles 14.
* `engine/` con funciones puras de evaluación, emisión de PDR y firma EIP 712.
* Módulo de tipo de cambio con dos fuentes (Personal).
* Verificador reproducible por línea de comandos.
* Tabla de custodia de llaves y procedimiento de rotación.

### Tareas

**T2.1 Congelar interfaces.**
Escribir los esquemas de la sección 2 en JSON Schema, zod y Solidity, con pruebas de que las tres versiones calculan el mismo hash para el mismo dato. Si TypeScript y Solidity no coinciden byte a byte, los contratos rechazan todo.
* **Personal (base):** `InvoiceExtraction`, `PaymentIntent` y `PolicyDecision`, congeladas el lunes 12.
* **Trade (agregado):** extracción de BL y factura comercial, `PurchaseOrder`, `ShipmentAttestation`, `FundIntent` y `DocumentDecision`, se congelan el miércoles 14.

**T2.2 Motor determinista.**
Funciones puras: sin red, sin LLM y sin reloj implícito (la hora entra como parámetro). Cada regla devuelve el nivel mínimo que fuerza y el nivel final es el máximo. Cada regla tiene su prueba unitaria. Las reglas se versionan, y el hash del archivo de reglas más el hash de la configuración de Roles forman el `policyHash`.

**Personal (base).** `evaluate(extraction, context) → { tier, rules[], intent }`:

| Regla | Pasa (nivel 1) | Escala | Bloquea (nivel 4) |
|---|---|---|---|
| Alias registrado | `alias_id` existe y está verificado | | alias desconocido |
| Emisor esperado | `issuer_tax_id` coincide con el registrado para el alias | | RUT distinto |
| Monto en rango | dentro de ±25% del promedio histórico del alias | fuera de rango: nivel 3 | |
| Cupo del periodo | cabe en el cupo restante | no cabe: nivel 3 | |
| Tipo de cambio | fuentes dentro de la tolerancia | divergencia: retener y avisar | |
| Idempotencia | `invoiceKey` nueva | | ya pagada |
| Cambio de cuenta | `mentions_account_change = false` | `true`: se abre una solicitud de cambio (nivel 2) y **no** se paga | |
| Texto oculto | `false` | `true`: nivel 3 y alerta | |
| Vencimiento | hay tiempo | vence pronto y está retenido: aviso urgente (D8) | |

**Trade (agregado).** `evaluateFunding(order, context) → { tier, rules[], intent }`, para el depósito:

| Regla | Pasa (nivel 1) | Escala | Bloquea |
|---|---|---|---|
| Orden firmada | Firmas de ambas partes válidas y orden abierta en el escrow | | falta una firma |
| Proveedor conocido | Exportador y cuenta de cobro ya verificados | proveedor nuevo: nivel 2 | parte no registrada |
| Cupo del periodo | El total cabe en el cupo restante | no cabe: nivel 3 | |
| Monto en rango | Dentro del rango habitual con ese proveedor | fuera de rango: nivel 3 | |
| Plazo | La fecha límite de embarque es futura y razonable | muy próxima: aviso | ya pasó |

`evaluateDocuments(order, attestation, extractions, context) → { conforms, rules[], decision }`, para el gatillo 2:

| Regla | Conforme | No conforme |
|---|---|---|
| Número de documento | El hash del número extraído es el `blNumberHash` de la atestación | distinto: retener y avisar |
| Fecha *on board* | Igual a la de la atestación y no posterior a la fecha límite | distinta o tardía |
| Monto de la factura | Igual al total de la orden, en su moneda | distinto |
| Partes | El importador de la factura es el de la orden | distinto |
| Incoterm y mercancía | Incoterm y código arancelario iguales a los de la orden | distintos |
| Cambio de cuenta | `mentions_account_change = false` | `true`: se retiene, se avisa y **nunca** cambia la cuenta de cobro |
| Texto oculto | `false` | `true`: retener y alerta |

**T2.3 Tipo de cambio (crítica 12). Solo Personal.**
* La factura viene en pesos y el pago se hace en el token.
* Usar dos fuentes: el dólar observado del Banco Central (por ejemplo, vía mindicador.cl) y la cotización de un exchange local de referencia (Buda u Orionx).
* Si divergen más de un 1,5%, la factura se retiene y se avisa.
* El monto en el token se calcula con la tasa menos favorable más un margen fijo declarado.
* La tasa, las dos fuentes y la hora de consulta entran al `inputsHash` del PDR.
* En la demo las fuentes pueden fijarse con valores grabados, pero el código y la regla deben ser los reales.
* El cupo del Roles Modifier acota el peor caso aunque alguien manipule la fuente. Esto se documenta como control.

En Trade no aplica: el monto se pacta en la orden directamente en el token de pago y la conversión ocurre fuera, al entrar y al salir.

**T2.4 Emisión y firma del PDR.**
* Construir el calldata exacto, calcular `calldataHash`, armar `PolicyDecision` y firmarla con la llave de política (EIP 712). En Personal la intención es el pago; en Trade, el depósito.
* Para nivel 3, generar el digest que debe firmar el cosignatario y entregarlo al Área 4.
* **Trade (agregado):** para el gatillo 2, armar y firmar `DocumentDecision`.
* Guardar el JSON completo de cada PDR en `evidence/pdr/`.

**T2.5 Simulación previa (crítica 18).**
`eth_call` de la llamada exacta antes de enviarla. Si revierte, el pago o la operación queda retenida con su motivo y no se gasta gas. Anvil queda solo para las pruebas.

**T2.6 Estados y aviso al fallar cerrado (crítica 19).**
* **Personal (base):** estados del pago: `pagado`, `retenido`, `en_aprobacion`, `cambio_en_cola`, `bloqueado`. Un programador revisa cada día los pagos retenidos y avisa (vía el bot del Área 4) a 5, 3 y 1 día del vencimiento, con el motivo y las instrucciones de pago manual.
* **Trade (agregado):** estados fuera de cadena que acompañan a los del escrow: `retenida`, `en_aprobacion`, `cambio_en_cola`, `bloqueada`. El programador revisa cada día las órdenes abiertas y avisa cuando se acerca la fecha límite de embarque, con el motivo y qué puede hacer la persona.

**T2.7 Custodia y rotación de llaves (crítica 13).**
Escribir y aplicar esta tabla:

| Llave | Qué puede hacer | Si la roban | Mitigación | Rotación |
|---|---|---|---|---|
| Relayer del agente | Pagar gas y llamar a los contratos | Nada sin un PDR o una firma válida | Saldo mínimo | Libre, sin Delay |
| Firmante de política | Firmar PDR | Personal: puede aprobar pagos dentro de Roles (lista blanca y cupo). Trade: puede depositar órdenes firmadas dentro del cupo y dar por conformes documentos que no lo son | Proceso separado, monitoreo, cupo de Roles; en Trade, además, la firma de la naviera | `setPolicySigner` vía Delay |
| Cosignatario | Vetar, pausar, revocar | Puede detener pagos y operaciones, no robar | Rol mínimo | El dueño la reemplaza vía Delay |
| Dueño (persona o empresa) | Configurar vía Delay; en Trade, firmar órdenes | Cambios de configuración visibles y vetables durante el enfriamiento; en Trade puede firmar órdenes | Umbral de la Safe, Delay y ConfigGuard | Recuperación de la Safe |
| Naviera (prueba, Trade) | Firmar atestaciones de embarque | Atestaciones falsas | Ventana de disputa; en producción, BL electrónico | Nueva orden con otra naviera |
| Árbitro (prueba, Trade) | Repartir entre las partes en una disputa | Reparto injusto, nunca hacia sí mismo | Opción 2 de 3 | Nueva orden con otro árbitro |
| Token del bot | Enviar mensajes | Mensajes falsos | Plantillas, lista de chats; el bot no firma nada | Regenerar en BotFather |
| API del LLM | Extraer documentos | Costo y abuso, no fondos | Variables de entorno, límite de gasto | Regenerar |

Para la demo, las llaves viven en archivos `.env` fuera del repositorio. En el documento se declara KMS o HSM como camino a producción.

**T2.8 Monitor de uso fuera del sistema (crítica 13).**
* Un vigía escucha los eventos del Roles Modifier y del gate; en Trade, también los del escrow.
* Si aparece una ejecución con el rol AGENTE que no corresponde a ningún PDR emitido por el motor, llama automáticamente al botón de pánico: revoca el rol (T1.3) usando la llave del cosignatario automático, o avisa al cosignatario humano.
* Es el cierre del acto 4.

**T2.9 Verificador reproducible.**
`keel verify <txHash>`:
1. Lee el evento.
2. Busca el PDR por su hash.
3. Recalcula la decisión con las mismas entradas y la misma versión de reglas.
4. Compara todos los hashes y muestra "coincide" o la diferencia exacta.

Es la herramienta que se le muestra al jurado para pasar de "tenemos logs" a "nuestras decisiones son verificables".

**T2.10 Vigilancia de plazos (agregada por Trade).**
Para cada orden en curso, el agente ejecuta `refundAfterDeadline` cuando pasó la fecha límite más el margen, y presenta la atestación con `submitShipment` cuando está disponible. Ambas llamadas las puede hacer cualquiera, así que no dan autoridad nueva al relayer.

### Listo cuando

* Las interfaces están congeladas y probadas en TS y Solidity.
* El motor tiene una prueba unitaria por regla y pasa los corpus del Área 3.
* El verificador reproduce al menos 5 decisiones reales de la red de prueba.
* La tabla de llaves está en el informe de seguridad.

### Dependencias

* Recibe direcciones del Área 1 (jueves 15) y extracciones del Área 3.
* Entrega PDR firmados al Área 1 para pruebas y avisos al Área 4.

### Si falta tiempo

Se recortan el monitor automático (queda solo como aviso humano), una de las dos fuentes de tipo de cambio de Personal (se declara) y la regla de monto en rango de Trade. **Nunca** se recortan la firma EIP 712, el verificador, la idempotencia ni la comparación de documentos contra la orden.

---

## 5. Área 3: Ingesta de documentos y extracción en cuarentena

**Perfil sugerido:** backend con experiencia en LLM, parsing de PDF y correo.
**Objetivo:** que nada de lo que llega en un correo o en un documento pueda convertirse en una cuenta de pago. Que las facturas legítimas se extraigan con la exactitud suficiente para pagar solas (Personal), y que los BL y facturas legítimos se lean con la exactitud suficiente para confirmar el embarque sin intervención (Trade).

### Entregables

* `ingest/` con canal de entrada autenticado, parser determinista, extractor en cuarentena y comparación entre ambos.
* Detección de cambio de cuenta: en Personal abre una solicitud de cambio y nunca un pago; en Trade abre una alerta y nunca un pago ni un cambio.
* Corpus de documentos legítimos y adversariales con etiquetas correctas, uno por modo.

### Tareas

**T3.1 Canal de entrada autenticado (crítica 10).**
* **Personal (base):** una casilla dedicada, por ejemplo con reenvío de correo a un webhook. Para cada correo se validan SPF, DKIM y DMARC, y se compara el dominio alineado con el dominio registrado para ese alias en el onboarding. Si falla, el correo queda en cuarentena y no se procesa; se registra en la bitácora con el motivo. Este canal ya está implementado.
* **Trade (agregado):** los documentos de una orden los sube una de sus partes desde la app, autenticada con su billetera. Se registra quién subió cada archivo y su hash. Si se acepta correo como canal secundario, pasa por la misma validación. Un documento que llega por correo nunca vale más que una lectura: no cambia nada de la orden.

**T3.2 Protección contra inundación (crítica 10).**
* **Personal (base):** máximo una solicitud de cambio de beneficiario pendiente por alias; límite de correos por remitente y por día; enfriamiento de 7 días tras un cambio rechazado o vetado.
* **Trade (agregado):** límite de documentos por orden y por día.
* En los dos modos: los duplicados se descartan por hash y las solicitudes o alertas se agrupan en un resumen en vez de notificarse una por una. Objetivo: que nadie firme por cansancio.

**T3.3 Parser determinista.**
* Extraer el texto del PDF y aplicar expresiones regulares.
  * **Personal (base):** RUT, folio, periodo, monto y vencimiento.
  * **Trade (agregado):** número de documento, fecha *on board*, puertos, número de factura, monto, moneda e incoterm. Como los BL no tienen formato estándar, el parser cubre los formatos del corpus (por ejemplo, dos navieras y una guía aérea) y se declara ese límite.
* Detectar texto oculto: color igual al fondo, tamaño menor a 4 puntos, fuera del área visible, capas superpuestas.
* Normalizar homoglifos (caracteres de otros alfabetos que se ven iguales) antes de comparar.

**T3.4 Extractor LLM en cuarentena.**
* Sin herramientas, temperatura 0 y salida estructurada con los esquemas estrictos de la sección 2.1.
* Nunca produce direcciones, cuentas ni nombres. En Personal, el modelo elige `alias_id` de un enum.
* Si el documento menciona una cuenta o un beneficiario distinto, solo marca `mentions_account_change = true`. En Personal, las direcciones encontradas las extrae el parser determinista y van **exclusivamente** al flujo de cambio de beneficiario (T3.6).
* Todo lo que no calce con el esquema se descarta y la factura o la operación queda retenida.

**T3.5 Concordancia de dos fuentes.**
* El extractor y el parser deben coincidir.
  * **Personal (base):** en RUT, folio, periodo y monto. Si hay diferencia, la factura queda en nivel 3.
  * **Trade (agregado):** en número de documento, fecha *on board*, monto y moneda. Si hay diferencia, la operación queda retenida.
* El aviso muestra los dos valores.
* Así se cubre el límite reconocido: un LLM manipulado puede devolver un valor falso dentro de un esquema válido.

**T3.6 Detección de cambio de cuenta.**
* **Personal (base):** genera una solicitud de cambio de beneficiario, no un pago. La solicitud incluye: dirección anterior y nueva, fuente, resultado de SPF/DKIM y hash del documento. Pasa al Área 4 (diff legible) y, si el dueño la confirma, al Delay del Área 1.
* **Trade (agregado):** genera una alerta, no un pago ni un cambio. La alerta incluye: fuente, canal, hash del documento y el recordatorio de que la cuenta de cobro solo cambia con una orden nueva firmada por ambas partes (D12). Se pasa al Área 4 para mostrarla.

**T3.7 Claves de idempotencia y de documento (crítica 11).**
* **Personal (base):** `invoiceKey = keccak256(issuer_tax_id, invoice_number, period)`, calculada con los valores normalizados. Reemplaza al hash del PDF, que se evade cambiando un píxel. Se deduplica al ingresar y además se hace cumplir en cadena (T1.6).
* **Trade (agregado):** `blNumberHash = keccak256(número de documento normalizado)`. Debe calcularse igual que en la atestación de la naviera, o el motor nunca dará conformidad. `docsHash = keccak256` del paquete de archivos, en un orden definido. La unicidad se hace cumplir en cadena: un BL no liquida dos órdenes (T1.9).

**T3.8 Corpus de documentos.**
* **Personal (base):**
  * Legítimas: al menos 12 facturas anonimizadas: luz, agua, internet, arriendo y gastos comunes, de 3 periodos distintos.
  * Adversariales: al menos 25 variantes: cuenta cambiada con el mismo formato, texto blanco con instrucciones, letra diminuta, homoglifos en el RUT, monto alterado, folio repetido con otro píxel, remitente falso que falla DKIM, correo legítimo reenviado con un adjunto cambiado, inyección en el campo del emisor.
* **Trade (agregado):**
  * Legítimos: al menos 12 conjuntos (BL o guía aérea más factura), anonimizados, coherentes con una orden de prueba cada uno.
  * Adversariales: al menos 25 variantes: factura con cuenta de cobro distinta, texto blanco con instrucciones, letra diminuta, homoglifos en el número de BL, fecha *on board* alterada, monto alterado, BL de otra orden, BL repetido con otro píxel, firma escaneada pegada, inyección en el campo del consignatario.
* Cada caso lleva su resultado esperado. Los corpus los usa el Área 5 para medir.

### Listo cuando

* Las 12 facturas legítimas de Personal se extraen bien de punta a punta.
* Los 12 conjuntos legítimos de Trade se leen bien de punta a punta y el motor los da por conformes.
* Ninguna variante adversarial produce un pago, una liberación de fondos ni un cambio de cuenta.
* Ningún dato del documento llega a un mensaje de Telegram ni a un PDR fuera de los campos tipados.

### Dependencias

* Recibe los esquemas del Área 2 (los de Trade, el miércoles 14), la tabla de alias con dominios y las órdenes de prueba del Área 4.
* Entrega extracciones al Área 2 y los corpus al Área 5 el viernes 16.

### Si falta tiempo

Se recortan el resumen diario (queda solo el límite de solicitudes pendientes), el canal de correo de Trade (queda solo la carga desde la app), la guía aérea (queda solo el BL marítimo) y la detección de capas superpuestas. **Nunca** se recortan el esquema sin texto libre, la concordancia de dos fuentes ni la validación SPF/DKIM del correo.

---

## 6. Área 4: Producto, onboarding y canal humano

**Perfil sugerido:** frontend o full stack con criterio de producto y UX.
**Objetivo:** que cada persona entienda lo que firma sin leer hexadecimal, que el primer registro de un beneficiario o de un proveedor no sea confianza ciega y que el cosignatario pueda frenar sin poder robar.

### Entregables

* App con dos tipos de cuenta:
  * **Personal:** onboarding, libreta de beneficiarios, diff legible de cambios, bitácora y panel de niveles.
  * **Empresa (Trade):** perfiles de importador y exportador, creación y firma de la orden, diff legible, estado del escrow y disputa.
  * Vista del cosignatario en los dos.
* Bot de Telegram con mensajes de plantilla y enlaces a la app.
* Firma de cada persona desde su propia billetera, sin llaves en el servidor.

### Tareas

**T4.1 Onboarding con verificación fuera de banda (crítica 9).**
1. Se registra la contraparte.
   * **Personal (base):** el usuario registra un beneficiario: alias, nombre, RUT, dominio de correo esperado y dirección de pago.
   * **Trade (agregado):** el importador registra un proveedor: nombre, identificador y cuenta de cobro.
2. Keel envía una **transferencia de prueba** de un monto aleatorio pequeño, por ejemplo 0,37.
3. El usuario le pide a la contraparte, por un canal distinto (teléfono o en persona), que le confirme el monto exacto recibido, y lo ingresa en la app.
4. Solo si coincide, la dirección queda verificada y su alta se encola a través del Delay: en la lista blanca (Personal) o como proveedor conocido (Trade).

El resultado de la verificación (monto, fecha y canal) se guarda como hash en la bitácora. En el deck esto se compara con los microdepósitos que usan los bancos. En Trade, un proveedor no conocido no impide firmar una orden, pero su primer depósito es de nivel 2.

**T4.2 Diff legible antes de firmar (crítica 17).**
* **Personal (base):** diff de un cambio de beneficiario. Pantalla con:
  * alias y nombre;
  * **cuenta anterior** en grupos cortos con identicon, fecha de verificación y pagos realizados;
  * **cuenta nueva** con identicon, "vista por primera vez hoy", fuente (correo de X) y resultado de SPF/DKIM;
  * qué cambia en el contrato y cuándo termina el enfriamiento.

  Antes de firmar, exige el paso de verificación por otro canal (T4.1).
* **Trade (agregado):** diff de la orden. Pantalla con:
  * partes, con nombre e identificador tomados del registro;
  * **cuenta de cobro** en grupos cortos con identicon, y si es la misma de órdenes anteriores con ese proveedor o "vista por primera vez hoy";
  * monto total, anticipo y saldo, fecha límite de embarque, naviera, árbitro e incoterm;
  * qué puede y qué no puede hacer el contrato con esos fondos.

En los dos, el botón por defecto es "Rechazar", no "Aprobar" ni "Firmar".

**T4.3 Bot de Telegram seguro (crítica 8).**
* Solo envía mensajes armados con plantillas y campos tipados: enums, montos y fechas. Nunca reenvía texto de un correo, un PDF u otro documento.
* Responde solo a una lista de chats registrados.
* No firma nada: los botones abren la app, donde firma la billetera de la persona.
* El token se guarda como se define en T2.7.

**T4.4 Firma sin llave en el servidor.**
* **Personal (base):** el dueño firma desde su billetera (WalletConnect o una billetera de navegador) y propone transacciones al Delay con el SDK de Safe.
* **Trade (agregado):** importador y exportador firman la orden desde su billetera, y los dueños proponen cambios al Delay de la misma forma.
* En la demo pueden ser billeteras de prueba, pero **nunca** una llave en el servidor. Esto separa a Keel del competidor, que reconoce tener la llave del dueño en el servidor.

**T4.5 Vista del cosignatario.**
* Lista de cambios en cola, con el diff legible y su cuenta regresiva.
* Botón "Vetar" y botón de pánico "Revocar al agente": cada uno es una sola transacción con el rol COSIGNATARIO (T1.3).
* Solicitudes de nivel 3 para cofirmar: pagos en Personal, depósitos en Trade.
* No hay ningún botón para iniciar pagos, porque el rol no lo permite.

**T4.6 Avisos de retenciones y de plazos (crítica 19).**
Diseñar los mensajes de T2.6.
* **Personal (base):** qué pasó, por qué, cuánto falta para el vencimiento y cómo pagar manualmente si es urgente. Probarlos con 2 personas ajenas al equipo.
* **Trade (agregado):** qué pasó, por qué, cuánto falta para la fecha límite y qué puede hacer la persona. Incluye los avisos de depósito, anticipo, embarque, saldo, reembolso y alerta de cambio de cuenta.

**T4.7 Bitácora y panel de niveles.**
* **Personal (base):** una línea por intento: estado (pagado, retenido, en cola, vetado, revertido en cadena), regla que decidió, nivel, enlace al PDR y a la transacción. Contador "facturas pagadas, ataques bloqueados, fondos perdidos: 0".
* **Trade (agregado):** una línea por evento: estado, regla que decidió, nivel, enlace al PDR y a la transacción. Contador "órdenes liquidadas, ataques bloqueados, fondos perdidos: 0".
* Panel con los niveles 0 a 4, común a los dos.
* Se usa en la demo y en las capturas.

**T4.8 Textos en inglés y diseño de la demo.**
* Todos los textos de la interfaz en inglés, claros, sin jerga cripto. En Personal, montos en pesos con su equivalente en el token.
* Coordinar con el Área 5 que cada acto de la demo se vea en una sola pantalla.

**T4.9 Perfiles y flujo de la orden (agregada por Trade).**
* Selección del tipo de cuenta al entrar: Personal o Empresa.
* Perfil de importador: crear una orden a partir de la proforma, firmarla, ver el depósito y el estado.
* Perfil de exportador: revisar y firmar la orden, ver que los fondos están depositados, subir el BL y la factura, ver el cobro.
* Vista de la orden con su estado en el escrow y la línea de tiempo: firmada, depositada, anticipo, embarcada, liquidada o reembolsada.

**T4.10 Disputa y cancelación (agregada por Trade, se recorta si falta tiempo).**
Botones para abrir una disputa y para cancelar de mutuo acuerdo, y una vista mínima para que el árbitro firme el reparto.

### Listo cuando

* Los cuatro actos de la demo se recorren desde la interfaz sin tocar la consola.
* Ninguna pantalla muestra una dirección completa sin identicon y sin alias o nombre.
* El bot pasa la prueba de inyección del Área 5: un emisor o un documento con instrucciones no aparece en ningún mensaje.

### Dependencias

* Recibe direcciones y ABIs del Área 1, estados del Área 2, y solicitudes de cambio y alertas del Área 3.
* Entrega capturas y la grabación al Área 5.

### Si falta tiempo

Se recortan la prueba con personas externas, la vista del árbitro (la disputa se muestra por script), la vista móvil y el alta de proveedor con transferencia de prueba (queda una lista precargada, y se declara). **Nunca** se recortan el diff legible, la verificación fuera de banda de Personal, los dos perfiles de Trade ni la firma sin llave en el servidor.

---

## 7. Área 5: Red team, evidencia, documentación y coordinación

**Perfil sugerido:** quien coordine, escriba bien en inglés y piense como atacante.
**Objetivo:** que todo lo que construyen las otras áreas se convierta en puntaje: evidencia con hash, métricas, un informe de seguridad honesto y una presentación clara. También es dueño del calendario y de la entrega.

### Entregables

* Batería de red team ejecutable con su reporte.
* Script de evidencia en cadena con `EXECUTION_EVIDENCE.md`.
* Informe de autoevaluación de seguridad con niveles de permiso y lista de riesgos conocidos.
* Documento técnico, README, deck de 10 minutos y video de 5 minutos, en inglés.
* Formulario de inscripción y entrega final.

### Tareas

**T5.1 Coordinación.**
* Inscribir al equipo y confirmar que se cumple el requisito de al menos 60% de integrantes no chinos.
* Enviar el correo a la organización (wangyr@pbcsf.tsinghua.edu.cn) con dos preguntas: si las transacciones en una red cerrada o de prueba cuentan como transacciones reales y cómo debe poder verificarlas el jurado, y si el cierre es el 20 de octubre o el 2 de noviembre.
* Reunión diaria de 15 minutos a la misma hora.
* Actualizar el tablero con las tareas de este documento: las de base y las agregadas por Trade.
* Puntos de integración de la sección 9.
* Cerrar con el equipo la decisión abierta 14 de [flujo_clave.md](flujo_clave.md): con qué profundidad entra Personal en la entrega.

**T5.2 Verificación de afirmaciones (crítica 16 y D9).**
Revisar cada cifra y afirmación antes de que entre al deck, y marcar con fuente o eliminar:
* incidente DRB y sus cifras;
* "imposible para cualquiera" y "ninguno conocido".

**Personal (base):**
* Neat Pagos;
* crecimiento de Cobre;
* "ningún competidor ataca el fraude de facturas". Reformular: el repositorio Leash ya trata facturas con cambio de datos.

**Trade (agregado):**
* costo y demora de las transferencias internacionales (hoy la única fuente es la entrevista);
* "con China casi no se usa carta de crédito" (ídem);
* regulación de cripto en China continental y de stablecoins en Hong Kong;
* qué plataformas de comercio exterior sobre blockchain y de BL electrónico existen, antes de decir que algo no existe.

Confirmar además si se puede citar al importador entrevistado.

**T5.3 Informe de autoevaluación de seguridad.**
* Tabla de niveles: nivel, qué cubre, dónde se hace cumplir (escrow, gate, Roles, motor o interfaz), prueba que lo demuestra y hash de evidencia. La construye con el Área 1.
* El nivel 4 se redacta con precisión: prohibido para el agente y el cosignatario; el dueño puede cambiar reglas solo vía Delay, con aviso y veto, y si no está el ConfigGuard, se declara que puede saltárselo.
* Lista de riesgos conocidos, sin "ninguno conocido".
  * Comunes: configuración de Roles no auditada por terceros; firmante de política en un servidor; riesgo de emisor del token de pago; Telegram como canal; la bitácora prueba lo registrado, no que nada se haya escapado.
  * **Personal (base):** fuentes del tipo de cambio; puente fiat centralizado.
  * **Trade (agregado):** contrato de escrow propio, sin auditoría de terceros; naviera y árbitro representados por llaves de prueba; registro de partes administrado por Keel; colusión de exportador y naviera; el anticipo solo se recupera por disputa; verificación pública limitada en una red cerrada.
* Tabla de llaves de T2.7.

**T5.4 Batería de red team (40 escenarios mínimo).**

Comunes y de Personal (base):

| Categoría | Ejemplos |
|---|---|
| Factura | cuenta cambiada; texto oculto; homoglifos; monto alterado; folio repetido con otro píxel |
| Correo | remitente falso sin DKIM; inundación de solicitudes; reenvío con adjunto cambiado |
| Interfaz | inyección en un campo dirigida a Telegram; diff con direcciones parecidas |
| Tipo de cambio | fuente manipulada; divergencia entre fuentes |
| Llaves | relayer robado; firmante de política robado; uso del rol fuera del sistema |
| Contrato | todos los casos de T1.7 ejecutados en la red de prueba |
| Onboarding | alta con dirección falsa; verificación con monto equivocado |

Agregados por Trade:

| Categoría | Ejemplos |
|---|---|
| Cuenta de cobro | correo de cambio de cuenta; factura con otra cuenta; orden nueva con una dirección parecida |
| Documentos | BL fabricado; firma escaneada pegada; fecha *on board* alterada; monto alterado; texto oculto; homoglifos |
| Embarque | atestación firmada por otra llave; atestación de otra orden; mismo BL en dos órdenes; embarque tardío |
| Escrow | retiro del importador; anticipo doble; reembolso anticipado; llamadas sobre estados finales; árbitro que intenta cobrar |

Métricas:
* tasa de bloqueo de ataques;
* falsos positivos sobre los documentos legítimos;
* porcentaje de facturas pagadas sin intervención humana (Personal) y de órdenes completadas sin intervención más allá de las firmas (Trade);
* latencia de decisión;
* **capa que detuvo cada ataque**: canal, extractor, motor, gate, Roles, escrow o humano.

La última métrica es la que mejor muestra la defensa en profundidad.

**T5.5 Script de evidencia en cadena.**
Un comando que, sobre el despliegue final, genera y documenta con su hash.

Personal (base):
1. Pago de nivel 1 exitoso.
2. Alta de beneficiario en cola y ejecutada tras el enfriamiento.
3. Cambio de beneficiario vetado por el cosignatario.
4. Pago de nivel 3 con cofirma.
5. Revert por destinatario fuera de la lista (Roles).
6. Revert por falta de PDR válido (gate).
7. Revert por calldata distinto del aprobado.
8. Revert por factura ya pagada.
9. Revert por `delegatecall`.
10. Revocación del rol por el botón de pánico.
11. Intento de pago posterior que revierte.

Agregado por Trade:
1. Orden abierta con ambas firmas.
2. Depósito de nivel 1 por el gate.
3. Anticipo liberado.
4. Embarque aceptado y saldo liberado.
5. Reembolso por vencimiento en otra orden.
6. Depósito de nivel 3 con cofirma.
7. Revert por atestación no firmada por la naviera.
8. Revert por fecha *on board* tardía.
9. Revert por BL ya usado.
10. Revert por intento de retiro o de llamada fuera de estado.
11. Revert del Roles por destino no permitido (el robo directo).
12. Revert por falta de PDR válido (gate).
13. Revocación del rol por el botón de pánico y depósito posterior que revierte.
14. Disputa resuelta por el árbitro (si T4.10 y la disputa no se recortan).

**T5.6 Documento técnico y README.**
* Documento técnico: arquitectura con diagrama, algoritmo central (motor más PDR más gate, y en Trade además el escrow), diseño de seguridad y comparación honesta con el estado del arte (Leash, Coinbase, Cobo, Safe con Roles, PACE).
* README: qué es, cómo desplegar, cómo correr las pruebas y la batería de red team, y enlaces a la evidencia.
* Mantener [flujo_clave.md](flujo_clave.md) al día cuando el equipo cierre una decisión abierta.

**T5.7 Deck y video.**
* Deck de 10 minutos con este orden: incidente DRB, problema, idea central, arquitectura, cuatro actos, métricas, seguridad, alineación con WeBank, límites honestos.
* Video de 5 minutos con los cuatro actos grabados desde la app del Área 4, con narración en inglés.
* Los cuatro actos de Personal (base): pago normal, factura fraudulenta, cambio legítimo de beneficiario y llave robada. Los cuatro de Trade (agregado): orden completa, fraude documental (cambio de cuenta y BL falso), proveedor que no embarca y llave robada. Trade es la demo principal; **abierto:** qué actos de Personal entran en el deck y en el video.
* Ensayo general el domingo 18.

### Listo cuando

* El script de evidencia corre de punta a punta sobre el despliegue final.
* La batería de red team y sus métricas están en el repositorio.
* Los seis elementos de la entrega están subidos el lunes 19 a las 22:00.

### Dependencias

Depende de todas las áreas. Por eso es dueño del calendario y puede pedir recortes.

### Si falta tiempo

Se recortan la comparación extensa con el estado del arte (queda una tabla) y la narración profesional del video. **Nunca** se recortan el informe de seguridad, la evidencia en cadena ni la entrega a tiempo.

---

## 8. Calendario (hora de Chile, propuesta desde el martes 13)

Este calendario es el que se replanificó para Trade. Las tareas de base de Personal todavía no tienen fechas propias desde el martes 13: el Área 5 las ubica cuando el equipo cierre la decisión abierta 14.

| Día | Hito | Áreas clave |
|---|---|---|
| Lun 12 | Inicio. Interfaces del pago de cuentas congeladas. Repositorio con estructura. | 2, 5 |
| Mar 13 | **Cambio de rumbo.** Objetivo y flujo publicados en `flujo_clave.md`. Borrador de las interfaces nuevas. Keel Personal vuelve al alcance. Tablero actualizado. | Todas |
| Mié 14 | **Interfaces nuevas congeladas a las 20:00. Red y token decididos.** TradeEscrow en pruebas locales. Motor con las primeras reglas. Parser y extractor sobre 3 conjuntos de documentos. | 1, 2, 3 |
| Jue 15 | **Despliegue v1 y primer revert real.** Firma EIP 712 compatible entre TS y Solidity. Rol AGENTE y PDRGate. Perfiles y firma de la orden en la app. | 1, 2, 4 |
| Vie 16 | **Integración de punta a punta: acto 1 en la red de prueba.** Corpus completo entregado. Primera corrida de red team. | Todas |
| Sáb 17 | Actos 2, 3 y 4 funcionando. Delay, cosignatario y botón de pánico. Disputa. Borradores de documentos. | Todas |
| Dom 18 | **Congelamiento de funciones a las 20:00.** Despliegue final. Script de evidencia. Ensayo general. | Todas |
| Lun 19 | Documentos, deck y video finales. **Entrega a las 22:00.** | 5 con apoyo de todos |
| Mar 20 | Margen. Cierre oficial a las 12:59. | 5 |

---

## 9. Puntos de integración

1. **Miércoles 14, 20:00:** congelamiento de las interfaces nuevas y decisión de red y token (Área 2 y Área 1 con todas).
2. **Jueves 15:** direcciones y ABIs publicados (Área 1 hacia 2, 4 y 5).
3. **Viernes 16:** una orden real de punta a punta: firma, depósito por el gate, anticipo, atestación, lectura de documentos, PDR y saldo, visible en la bitácora.
4. **Domingo 18:** despliegue final. Después de esto no se cambian contratos, solo documentos.

El punto de integración de Personal (un pago real de punta a punta: correo, extracción, motor, PDR, gate, Roles y token, visible en la bitácora) no tiene fecha todavía. Depende de la decisión abierta 14.

Regla de trabajo: cada área trabaja en su carpeta y en sus propias ramas. Los cambios a `schemas/` los aprueba el Área 2, y los cambios a contratos ya desplegados, el Área 1.

---

## 10. Reglas de recorte globales

Si el viernes 16 el acto 1 no funciona de punta a punta, el Área 5 activa el recorte en este orden:

1. Disputa con vista del árbitro (queda por script, o como diseño).
2. Liberación diferida por ventana de disputa.
3. Registro de partes en cadena (queda una lista fija).
4. ConfigGuard (se declara el riesgo).
5. Monitor automático (queda el aviso humano).
6. Guía aérea y canal de correo de Trade (quedan el BL marítimo y la carga desde la app).
7. Alta de proveedor con transferencia de prueba (queda una lista precargada).
8. Segunda fuente de tipo de cambio de Personal (se declara).
9. Resumen diario de solicitudes de Personal.

**Nunca caen:** PDRGate, rol AGENTE, Delay para cambios, cosignatario con veto, extracción sin texto libre, TradeEscrow con sus cuatro invariantes, firma de la orden por ambas partes, atestación de embarque firmada, reembolso por vencimiento, cuatro actos de la demo, script de evidencia, informe de seguridad.

**Abierto:** dónde entra Keel Personal en este orden si falta tiempo. Depende de la decisión abierta 14.

---

## 11. Mapa de críticas

Las críticas se recibieron sobre la propuesta de pago de cuentas, así que aplican tal cual a Personal. La columna de Trade indica la tarea que las resuelve en el flujo de comercio exterior cuando es distinta.

| # | Crítica | Área | Tarea | En Trade |
|---|---|---|---|---|
| 8 | Texto libre en el esquema; eliminar el LLM operativo | 2, 3, 4 | D2, D3, T3.4, T4.3 | Igual |
| 9 | Onboarding con confianza ciega | 4 | T4.1 | Igual |
| 10 | Canal de entrada sin validar y solicitudes en masa | 3 | T3.1, T3.2 | Igual |
| 11 | Idempotencia evadible cambiando un píxel | 3, 1 | T3.7, T1.6 | T3.7, T1.9 |
| 12 | Tipo de cambio como superficie de ataque | 2 | T2.3 | No aplica: el monto se pacta en el token |
| 13 | Custodia de llaves y botón de pánico | 2, 1 | T2.7, T2.8, T1.3 | Igual |
| 14 | Módulos auditados no implican configuración auditada | 1 | T1.7 | T1.7, T1.10 |
| 15 | Niveles 0 y 3 sin implementar; umbral global de la Safe; cosignatario que puede proponer | 1 | T1.3, T1.6 paso 8, D6 | Igual |
| 16 | Sobreafirmaciones | 5, 1 | D9, T5.2, T5.3, T1.5 | Igual |
| 17 | El humano firma direcciones hexadecimales | 4 | T4.2 | Igual |
| 18 | La simulación aporta poco para un transfer | 2 | D7, T2.5 | Igual |
| 19 | Fallar cerrado tiene costo real | 2, 4 | D8, T2.6, T4.6 | Igual |
| 1 a 7 | No incluidas en la captura | Por asignar | Por asignar | Por asignar |

**Nota sobre el nivel 0:** las lecturas (consultar saldos, ver facturas, órdenes, documentos y bitácora) no firman nada. Se implementan como ausencia de capacidad: el lector no tiene llaves y el chat, si existe, no tiene herramientas que muevan fondos. En el informe se declara así, con la prueba de que el componente de lectura no tiene permisos en Roles.
