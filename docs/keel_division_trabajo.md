# Keel: división del trabajo en 5 áreas

**Proyecto:** Keel, agent wallet para comercio exterior: paga órdenes de compra internacionales solo cuando se cumplen condiciones verificables, con un contrato de escrow
**Competencia:** 2026 Shenzhen FinTechathon, International Track, Topic F: Agent Wallet
**Cierre:** martes 20 de octubre, 23:59 hora de Beijing, que en Chile es **martes 20 a las 12:59**. Planificamos entregar el **lunes 19 a las 22:00** (hora de Chile) y dejar el martes como margen.
**Lema:** la IA interpreta una vez, el contrato obedece siempre.

**Cambio de rumbo (13 de octubre de 2026):** Keel dejó de ser un pagador de cuentas básicas. Ahora aplica el flujo de escrow a la importación de productos desde China por empresas chilenas, con el corredor Chile y Hong Kong como objetivo, sobre una red cerrada. El objetivo y el flujo están en [flujo_clave.md](flujo_clave.md), que manda si hay diferencias.

Este documento se adaptó a ese cambio con tres criterios:

- Las áreas, sus dueños y los identificadores de tarea se mantienen. Una tarea que sigue vigente conserva su número y cambia su contenido. Las tareas nuevas tienen números nuevos.
- Lo que ya no aplica queda marcado como **retirada**, para no perder la referencia en el tablero.
- Las tareas nuevas, el calendario desde el martes 13 y las interfaces de la sección 2 son una **propuesta**. Las confirma el equipo: las interfaces el Área 2, el calendario el Área 5.

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
| D5 | **Los cambios de configuración pasan por el Delay Modifier:** proveedores conocidos, cupos, firmante de la política y miembros de roles. Tienen aviso y ventana de veto. | Hace verificable el nivel 2 y responde a la crítica 16. |
| D6 | **El cosignatario no es dueño de la Safe.** Tiene un rol propio que solo le permite vetar, pausar y revocar el rol del agente. | Crítica 15: en una Safe, cualquier dueño puede proponer. |
| D7 | **La simulación en tiempo de ejecución es `eth_call`.** Anvil se usa solo para las pruebas. | Crítica 18. |
| D8 | **Fallar cerrado siempre avisa:** toda operación retenida notifica el motivo, la fecha límite y la alternativa manual. | Crítica 19. |
| D9 | **Nada de sobreafirmaciones.** Ninguna celda dice "ninguno conocido" ni "imposible para cualquiera". Cada afirmación de seguridad dice para quién vale, dónde se hace cumplir y qué prueba lo demuestra. | Crítica 16. |
| D10 | Todo lo que se entrega al jurado va en inglés. El trabajo interno puede ir en español. | Bases del concurso. |
| D11 | **El objetivo del proyecto es el flujo de [flujo_clave.md](flujo_clave.md).** Se consulta antes de idear o crear un componente. | Cambio de rumbo del 13 de octubre. |
| D12 | **La cuenta de cobro nunca sale de un documento.** Sale de la orden de compra firmada por ambas partes; cambiarla exige una orden nueva. | Es la defensa contra el fraude de cambio de cuenta. |
| D13 | **La prueba de embarque es una firma de un tercero, no un PDF.** La IA lee datos, no valida firmas. | Una firma escaneada es una imagen. |
| D14 | **Quien frena o arbitra no puede cobrar.** El contrato de escrow solo paga al importador o a la cuenta de cobro de la orden. | Extiende D6 al árbitro. |

---

## 2. Interfaces compartidas (propuesta, se congelan el miércoles 14 a las 20:00)

El Área 2 es dueña de estas definiciones. Viven en `schemas/`, como JSON Schema y tipos TypeScript (zod), y como structs en Solidity. Cambiarlas después del congelamiento exige avisar a las 5 áreas.

Las interfaces congeladas el lunes 12 eran las del pago de cuentas (`InvoiceExtraction`, `PaymentIntent`). Se reemplazan por las siguientes. `PolicyDecision` se conserva.

### 2.1 Extracción de documentos (salida del extractor en cuarentena)

Documento de transporte:

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

### 2.2 Orden de compra y atestación de embarque

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
```

El detalle de cada campo está en la sección 5.5 y 5.8 de [KEEL_SOLUCION_ALCANCE.md](KEEL_SOLUCION_ALCANCE.md).

### 2.3 Intención de depósito y decisiones (PDR de Keel)

```solidity
struct FundIntent {
    bytes32 orderId;
    address escrow;         // el contrato TradeEscrow
    address token;
    uint256 amount;         // igual al totalAmount de la orden
    uint64  deadline;
    uint256 nonce;
}

struct PolicyDecision {
    bytes32 intentHash;     // hash EIP 712 de FundIntent
    bytes32 calldataHash;   // keccak256 del calldata exacto que ejecuta la Safe
    bytes32 policyHash;     // versión vigente de las reglas
    bytes32 inputsHash;     // orden, registro de proveedores, cupo usado
    uint8   tier;           // 1 o 3 (los niveles 0, 2 y 4 no llegan al gate)
    uint64  expiresAt;
}

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
* **Abierto:** qué firmante de política acepta el escrow para `DocumentDecision` (uno registrado en el contrato o uno fijado en cada orden) y si esa decisión es obligatoria para liberar el saldo.

### 2.4 Eventos y errores tipados (nombres fijos)

* PDRGate, eventos: `FundingExecuted`, `OperationHeld`, `AgentRoleRevoked`, `GatePaused`.
* PDRGate, errores: `IntentMismatch`, `CalldataMismatch`, `BadPolicySignature`, `MissingCosignature`, `StalePolicy`, `Expired`, `NonceUsed`, `GateIsPaused`.
* TradeEscrow, eventos: `OrderOpened`, `OrderFunded`, `AdvanceReleased`, `ShipmentAccepted`, `BalanceReleased`, `Refunded`, `DisputeRaised`, `DisputeResolved`, `OrderCancelled`.
* TradeEscrow, errores: `InvalidState`, `OrderExists`, `BadImporterSignature`, `BadExporterSignature`, `BadCarrierSignature`, `BadDocumentDecision`, `ShipmentTooLate`, `BillOfLadingAlreadyUsed`, `DeadlineNotReached`, `NotParty`, `BadResolution`, `TokenNotAllowed`, `AmountMismatch`.

### 2.5 Estructura del repositorio

```
contracts/   Solidity, Foundry, scripts de despliegue              (Área 1)
schemas/     JSON Schema, tipos TS, structs EIP 712                 (Área 2)
engine/      motor de política, PDR, firmas, verificador            (Área 2)
ingest/      recepción de documentos, parser, extractor             (Área 3)
app/         perfiles, firma de la orden, diff legible, cosignatario (Área 4)
bot/         bot de Telegram con plantillas                         (Área 4)
redteam/     escenarios, corpus adversarial, métricas               (Área 5)
docs/        objetivo, documento técnico, seguridad, deck           (Área 5)
evidence/    PDR y evidencia en cadena                              (Área 5)
```

---

## 3. Área 1: Contratos y permisos en cadena

**Perfil sugerido:** quien tenga más experiencia en Solidity y Foundry.
**Objetivo:** que los fondos de una orden solo puedan ir al exportador o volver al importador, según las condiciones firmadas. Y que ni la IA, ni la llave del agente, ni el motor de política comprometido puedan desviarlos.

### Entregables

* TradeEscrow, PDRGate, Safe, Roles Modifier v2 y Delay Modifier desplegados en la red elegida.
* Batería de pruebas negativas, con fuzz e invariantes.
* `contracts/deployments/<chainId>.json` con todas las direcciones.
* Tabla "nivel → dónde se hace cumplir → prueba", que se entrega al Área 5.

### Tareas

**T1.0 Red y token (nueva, bloquea el resto).**
Elegir con el equipo la red cerrada y el token de pago. Confirmar que Safe y los módulos de Zodiac se pueden desplegar ahí y qué herramientas quedan disponibles (SDK, explorador). Si la red no tiene una stablecoin, desplegar un token de prueba y declararlo. Si Safe o Zodiac no se pueden desplegar, avisar el mismo día: cambia el diseño de permisos.

**T1.1 Safe de la empresa.**
Desplegar una Safe para el importador y otra para el exportador. En la demo pueden ser 1 de 1; documentar que en producción serían 2 de 3 socios. El cosignatario **no** se agrega como dueño (D6).

**T1.2 Rol AGENTE en el Roles Modifier.**
* Miembro único: la dirección de PDRGate (D4).
* Destinos permitidos: el contrato TradeEscrow y el token de pago.
* Funciones permitidas: `fund(orderId)` en el escrow, y en el token solo la aprobación necesaria para ese depósito, con `spender` igual al escrow. Nunca `transfer` ni aprobaciones a otra dirección.
* Condición sobre el monto: dentro de un cupo por periodo, con recarga automática.
* Opciones de ejecución: sin `delegatecall` y sin `value`.
* Armar la configuración con el SDK de Zodiac Roles. Guardarla como archivo versionado: su hash es la parte en cadena del `policyHash`.
* **Abierto:** aprobación exacta más `fund`, o `fundWithPermit` si el token lo soporta.

**T1.3 Rol COSIGNATARIO en el Roles Modifier.**
* Miembro: la llave del cosignatario.
* Funciones permitidas y nada más: vetar un cambio en cola en el Delay, revocar la membresía de PDRGate en el rol AGENTE (botón de pánico) y pausar PDRGate.
* Con esto, "el cosignatario no puede iniciar envíos" es cierto a nivel de protocolo, no solo de interfaz (crítica 15).

**T1.4 Delay Modifier para cambios de configuración.**
* Todo cambio de proveedores conocidos, cupos, firmante de política y membresías se encola ahí, con un enfriamiento de 3 minutos en la demo y 48 horas en el documento de producción.
* Definir con el Área 4 cómo el dueño propone el cambio desde su billetera.
* Este es el **nivel 2** en cadena.

**T1.5 ConfigGuard (prioridad media, se recorta si falta tiempo).**
* Guard de la Safe que rechaza llamadas directas del dueño hacia Roles, Delay y PDRGate, para que esos cambios solo lleguen por el Delay.
* Sin este guard, el dueño puede saltarse el retraso, y eso **debe declararse** en el informe de seguridad (D9, crítica 16).

**T1.6 Contrato PDRGate.**
`execute(FundIntent intent, PolicyDecision d, bytes sigPolicy, bytes sigCosigner)` hace, en este orden:
1. Rechaza si está pausado (`GateIsPaused`).
2. Recalcula el hash EIP 712 de la intención y lo compara con `d.intentHash` (`IntentMismatch`).
3. Construye el calldata **dentro del contrato** a partir de la intención y compara su hash con `d.calldataHash` (`CalldataMismatch`).
4. Verifica que `sigPolicy` venga del firmante de política registrado (`BadPolicySignature`).
5. Verifica `d.policyHash == currentPolicyHash` (`StalePolicy`).
6. Verifica expiración y fecha límite (`Expired`).
7. Verifica y consume el nonce (`NonceUsed`).
8. Si `d.tier == 3`, exige una firma válida del cosignatario sobre el mismo digest (`MissingCosignature`).
9. Ejecuta a través del Roles Modifier con el rol AGENTE. Los límites de Roles se siguen aplicando aunque todo lo anterior pase.
10. Emite `FundingExecuted(intentHash, pdrHash, tier, orderId)`.

La idempotencia del depósito queda en el escrow: una orden solo se deposita una vez (`InvalidState`), así que ni un motor comprometido puede pagarla dos veces (crítica 11). `setPolicySigner` y `setPolicyHash` solo pueden llamarse desde la Safe, por el camino del Delay.

**T1.7 Batería de pruebas negativas (crítica 14).**
Con Foundry y la configuración real de Roles. Cada caso debe revertir con el error esperado:

| Grupo | Casos |
|---|---|
| Rol mal usado | `delegatecall`; `value` mayor que cero; otro token; `transfer` directo; aprobación a otra dirección; llamada a otro contrato; monto sobre el cupo del periodo |
| MultiSend | Llamadas empaquetadas con relleno al final (la falla conocida del desensamblador); llamada anidada al Roles Modifier |
| Escalada | Agente que intenta cambiar la configuración de Roles o asignarse roles; cosignatario que intenta transferir |
| PDR | Calldata distinto del aprobado; intención alterada en un byte; firma de otro firmante; política vieja; PDR expirado; nonce repetido; nivel 3 sin cosignatario |
| Pausa y pánico | Depósito con el gate en pausa; depósito después de revocar el rol |
| Escrow, apertura | Firma del importador o del exportador inválida; orden repetida; naviera o árbitro igual a una de las partes; token no permitido; fecha límite pasada |
| Escrow, fondos | Depósito de quien no es el importador; monto distinto del total; segundo depósito de la misma orden; anticipo dos veces |
| Escrow, embarque | Atestación firmada por otra llave; atestación de otra orden; fecha *on board* posterior a la límite; BL ya usado; decisión de documentos inválida; embarque con disputa abierta |
| Escrow, cierre | Reembolso antes de la fecha límite; reembolso tras liquidar; resolución cuya suma no es el saldo; resolución sin firma del árbitro; cualquier llamada sobre un estado final |

**T1.8 Despliegue y verificación.**
Script de despliegue reproducible y un archivo de direcciones que consumen las demás áreas. Coordinar con el Área 5 cómo el jurado puede verificar las transacciones en una red cerrada.

**T1.9 Contrato TradeEscrow (nueva, es la pieza central).**
Implementar la máquina de estados y la interfaz de la sección 5.14 de [KEEL_SOLUCION_ALCANCE.md](KEEL_SOLUCION_ALCANCE.md): `open`, `fund`, `releaseAdvance`, `submitShipment`, `refundAfterDeadline`, `raiseDispute`, `resolve`, `cancel`.
* Verificación de firmas EIP 712 de importador, exportador, naviera y árbitro, con soporte de ERC-1271 para que firmen Safes.
* Depósito exacto, comparando el saldo antes y después.
* Patrón checks, effects, interactions y guard de reentrancia. Solo tokens permitidos.
* Plazos en días u horas, con margen de gracia antes del reembolso.
* Decisiones que hay que cerrar antes de escribir: anticipo en la misma transacción del depósito, ventana de disputa por defecto, resolución por árbitro solo o 2 de 3.

**T1.10 Invariantes del escrow con fuzz (nueva).**
1. Lo pagado en total nunca supera lo depositado.
2. Ningún fondo sale hacia una dirección que no sea `importer` o `payoutAddress`.
3. Un estado final nunca vuelve a mover fondos.
4. Un mismo BL nunca liquida dos órdenes.

**T1.11 Registro de partes (nueva, se recorta si falta tiempo).**
`PartyRegistry` administrado por Keel: `open` exige que importador, exportador, naviera y árbitro estén registrados. En la demo, la naviera y el árbitro son llaves de prueba, y se declara.

### Listo cuando

* Las pruebas de T1.7 y T1.10 pasan con `forge test`, con al menos 30 casos negativos y las 4 invariantes.
* Existe al menos un revert real en la red elegida por cada error tipado del escrow y del gate que se use en la demo.
* El Área 5 tiene la tabla de niveles y dónde se hace cumplir cada uno.

### Dependencias

* Necesita las estructuras de la sección 2 (Área 2), congeladas el miércoles 14.
* Entrega direcciones a las Áreas 2, 4 y 5 el jueves 15.

### Si falta tiempo

Se recorta en este orden: ConfigGuard (se declara el riesgo), registro de partes (queda una lista fija en el despliegue), liberación diferida por ventana de disputa, `fundWithPermit`, resolución 2 de 3. **Nunca** se recortan TradeEscrow con sus cuatro invariantes, el reembolso por vencimiento, PDRGate, el rol AGENTE ni la batería negativa.

---

## 4. Área 2: Motor de política, PDR y claves

**Perfil sugerido:** backend en TypeScript con interés en criptografía.
**Objetivo:** convertir una orden firmada y unos documentos leídos en decisiones deterministas, reproducibles y firmadas, que los contratos puedan verificar. Además, ser dueño de las interfaces y de la custodia de llaves.

### Entregables

* `schemas/` congelado el miércoles 14.
* `engine/` con funciones puras de evaluación, emisión de PDR y firma EIP 712.
* Verificador reproducible por línea de comandos.
* Tabla de custodia de llaves y procedimiento de rotación.

### Tareas

**T2.1 Congelar interfaces (miércoles 14).**
Escribir los esquemas de la sección 2 en JSON Schema, zod y Solidity, con pruebas de que las tres versiones calculan el mismo hash para el mismo dato. Si TypeScript y Solidity no coinciden byte a byte, los contratos rechazan todo.

**T2.2 Motor determinista.**
Funciones puras: sin red, sin LLM y sin reloj implícito (la hora entra como parámetro). Cada regla devuelve el nivel mínimo que fuerza y el nivel final es el máximo. Cada regla tiene su prueba unitaria. Las reglas se versionan, y el hash del archivo de reglas más el hash de la configuración de Roles forman el `policyHash`.

`evaluateFunding(order, context) → { tier, rules[], intent }`, para el depósito:

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

**T2.3 Tipo de cambio.**
**Retirada.** El monto se pacta en la orden directamente en el token de pago, así que ni el motor ni el contrato necesitan tipo de cambio. La conversión ocurre fuera, al entrar y al salir.

**T2.4 Emisión y firma del PDR.**
* Depósito: construir el calldata exacto, calcular `calldataHash`, armar `PolicyDecision` y firmarla con la llave de política. Para nivel 3, generar el digest que debe firmar el cosignatario y entregarlo al Área 4.
* Gatillo 2: armar y firmar `DocumentDecision`.
* Guardar el JSON completo de cada PDR en `evidence/pdr/`.

**T2.5 Simulación previa (crítica 18).**
`eth_call` de la llamada exacta antes de enviarla. Si revierte, la operación queda retenida con su motivo y no se gasta gas.

**T2.6 Estados de la orden y aviso al fallar cerrado (crítica 19).**
* Estados fuera de cadena que acompañan a los del escrow: `retenida`, `en_aprobacion`, `cambio_en_cola`, `bloqueada`.
* Un programador revisa cada día las órdenes abiertas y avisa (vía el bot del Área 4) cuando se acerca la fecha límite de embarque, con el motivo y qué puede hacer la persona.

**T2.7 Custodia y rotación de llaves (crítica 13).**

| Llave | Qué puede hacer | Si la roban | Mitigación | Rotación |
|---|---|---|---|---|
| Relayer del agente | Pagar gas y llamar a los contratos | Nada sin un PDR o una firma válida | Saldo mínimo | Libre, sin Delay |
| Firmante de política | Firmar PDR | Puede depositar órdenes firmadas dentro del cupo y dar por conformes documentos que no lo son | Proceso separado, monitoreo, cupo de Roles, firma de la naviera | `setPolicySigner` vía Delay |
| Cosignatario | Vetar, pausar, revocar | Puede detener operaciones, no robar | Rol mínimo | El dueño la reemplaza vía Delay |
| Dueño (cada empresa) | Firmar órdenes, configurar vía Delay | Puede firmar órdenes; los cambios de configuración son visibles y vetables | Umbral de la Safe, Delay y ConfigGuard | Recuperación de la Safe |
| Naviera (prueba) | Firmar atestaciones de embarque | Atestaciones falsas | Ventana de disputa; en producción, BL electrónico | Nueva orden con otra naviera |
| Árbitro (prueba) | Repartir entre las partes en una disputa | Reparto injusto, nunca hacia sí mismo | Opción 2 de 3 | Nueva orden con otro árbitro |
| Token del bot | Enviar mensajes | Mensajes falsos | Plantillas, lista de chats; el bot no firma nada | Regenerar en BotFather |
| API del LLM | Extraer documentos | Costo y abuso, no fondos | Variables de entorno, límite de gasto | Regenerar |

Para la demo, las llaves viven en archivos `.env` fuera del repositorio. En el documento se declara KMS o HSM como camino a producción.

**T2.8 Monitor de uso fuera del sistema (crítica 13).**
* Un vigía escucha los eventos del Roles Modifier, del gate y del escrow.
* Si aparece una ejecución con el rol AGENTE que no corresponde a ningún PDR emitido por el motor, llama al botón de pánico (T1.3) o avisa al cosignatario humano.
* Es el cierre del acto 4.

**T2.9 Verificador reproducible.**
`keel verify <txHash>`:
1. Lee el evento.
2. Busca el PDR por su hash.
3. Recalcula la decisión con las mismas entradas y la misma versión de reglas.
4. Compara todos los hashes y muestra "coincide" o la diferencia exacta.

**T2.10 Vigilancia de plazos (nueva).**
Para cada orden en curso, el agente ejecuta `refundAfterDeadline` cuando pasó la fecha límite más el margen, y presenta la atestación con `submitShipment` cuando está disponible. Ambas llamadas las puede hacer cualquiera, así que no dan autoridad nueva al relayer.

### Listo cuando

* Las interfaces están congeladas y probadas en TS y Solidity.
* El motor tiene una prueba unitaria por regla y pasa el corpus del Área 3.
* El verificador reproduce al menos 5 decisiones reales de la red de prueba.
* La tabla de llaves está en el informe de seguridad.

### Dependencias

* Recibe direcciones del Área 1 (jueves 15) y extracciones del Área 3.
* Entrega PDR firmados al Área 1 para pruebas y avisos al Área 4.

### Si falta tiempo

Se recorta el monitor automático (queda solo como aviso humano) y la regla de monto en rango. **Nunca** se recortan la firma EIP 712, el verificador ni la comparación de documentos contra la orden.

---

## 5. Área 3: Ingesta de documentos y extracción en cuarentena

**Perfil sugerido:** backend con experiencia en LLM y parsing de PDF.
**Objetivo:** que nada de lo que llega en un documento pueda convertirse en una cuenta de cobro, y que los BL y facturas legítimos se lean con la exactitud suficiente para confirmar el embarque sin intervención.

### Entregables

* `ingest/` con canal de entrada autenticado, parser determinista, extractor en cuarentena y comparación entre ambos.
* Detección de cambio de cuenta que abre una alerta y nunca un pago.
* Corpus de documentos legítimos y adversariales con etiquetas correctas.

### Tareas

**T3.1 Canal de entrada autenticado (crítica 10).**
* Los documentos de una orden los sube una de sus partes desde la app, autenticada con su billetera. Se registra quién subió cada archivo y su hash.
* Si se acepta correo como canal secundario, se validan SPF, DKIM y DMARC contra el dominio registrado de la parte. Si falla, el correo queda en cuarentena y se registra en la bitácora.
* Un documento que llega por correo nunca vale más que una lectura: no cambia nada de la orden.

**T3.2 Protección contra inundación (crítica 10).**
* Límite de documentos por orden y por día.
* Duplicados descartados por hash.
* Las alertas se agrupan en un resumen en vez de notificarse una por una. Objetivo: que nadie firme por cansancio.

**T3.3 Parser determinista.**
* Extraer el texto del PDF y aplicar expresiones regulares para número de documento, fecha *on board*, puertos, número de factura, monto, moneda e incoterm.
* Como los BL no tienen formato estándar, el parser cubre los formatos del corpus (por ejemplo, dos navieras y una guía aérea) y se declara ese límite.
* Detectar texto oculto: color igual al fondo, tamaño menor a 4 puntos, fuera del área visible, capas superpuestas.
* Normalizar homoglifos antes de comparar.

**T3.4 Extractor LLM en cuarentena.**
* Sin herramientas, temperatura 0 y salida estructurada con los esquemas estrictos de la sección 2.1.
* Nunca produce direcciones, cuentas ni nombres.
* Si el documento menciona una cuenta o un beneficiario distinto, solo marca `mentions_account_change = true`.
* Todo lo que no calce con el esquema se descarta y la operación queda retenida.

**T3.5 Concordancia de dos fuentes.**
* El extractor y el parser deben coincidir en número de documento, fecha *on board*, monto y moneda.
* Si hay diferencia, la operación queda retenida, con aviso que muestra los dos valores.
* Así se cubre el límite reconocido: un LLM manipulado puede devolver un valor falso dentro de un esquema válido.

**T3.6 Detección de cambio de cuenta.**
* Genera una alerta, no un pago ni un cambio.
* La alerta incluye: fuente, canal, hash del documento y el recordatorio de que la cuenta de cobro solo cambia con una orden nueva firmada por ambas partes (D12).
* Se pasa al Área 4 para mostrarla.

**T3.7 Claves de documento (crítica 11).**
* `blNumberHash = keccak256(número de documento normalizado)`. Debe calcularse igual que en la atestación de la naviera, o el motor nunca dará conformidad.
* `docsHash = keccak256` del paquete de archivos, en un orden definido.
* La unicidad se hace cumplir en cadena: un BL no liquida dos órdenes (T1.9).

**T3.8 Corpus de documentos.**
* **Legítimos:** al menos 12 conjuntos (BL o guía aérea más factura), anonimizados, coherentes con una orden de prueba cada uno.
* **Adversariales:** al menos 25 variantes: factura con cuenta de cobro distinta, texto blanco con instrucciones, letra diminuta, homoglifos en el número de BL, fecha *on board* alterada, monto alterado, BL de otra orden, BL repetido con otro píxel, firma escaneada pegada, inyección en el campo del consignatario.
* Cada caso lleva su resultado esperado. El corpus lo usa el Área 5 para medir.

### Listo cuando

* Los 12 conjuntos legítimos se leen bien de punta a punta y el motor los da por conformes.
* Ninguna variante adversarial produce una liberación de fondos ni un cambio de cuenta.
* Ningún dato del documento llega a un mensaje de Telegram ni a un PDR fuera de los campos tipados.

### Dependencias

* Recibe los esquemas del Área 2 el miércoles 14 y las órdenes de prueba del Área 4.
* Entrega extracciones al Área 2 y el corpus al Área 5 el viernes 16.

### Si falta tiempo

Se recortan el canal de correo (queda solo la carga desde la app), la guía aérea (queda solo el BL marítimo) y la detección de capas superpuestas. **Nunca** se recortan el esquema sin texto libre ni la concordancia de dos fuentes.

---

## 6. Área 4: Producto, onboarding y canal humano

**Perfil sugerido:** frontend o full stack con criterio de producto y UX.
**Objetivo:** que importador y exportador entiendan lo que firman sin leer hexadecimal, que el alta de un proveedor no sea confianza ciega y que el cosignatario pueda frenar sin poder robar.

### Entregables

* App: perfiles de importador y exportador, creación y firma de la orden, diff legible, estado del escrow, disputa, vista del cosignatario, bitácora y panel de niveles.
* Bot de Telegram con mensajes de plantilla y enlaces a la app.
* Firma de cada parte desde su propia billetera, sin llaves en el servidor.

### Tareas

**T4.1 Alta de proveedor con verificación fuera de banda (crítica 9).**
1. El importador registra un proveedor: nombre, identificador y cuenta de cobro.
2. Keel envía una **transferencia de prueba** de un monto aleatorio pequeño.
3. El importador le pide al proveedor, por un canal distinto, que le confirme el monto exacto recibido, y lo ingresa en la app.
4. Solo si coincide, el proveedor queda como conocido. El alta pasa por el Delay.

Un proveedor no conocido no impide firmar una orden, pero su primer depósito es de nivel 2.

**T4.2 Diff legible de la orden antes de firmar (crítica 17).**
Pantalla con:
* partes, con nombre e identificador tomados del registro;
* **cuenta de cobro** en grupos cortos con identicon, y si es la misma de órdenes anteriores con ese proveedor o "vista por primera vez hoy";
* monto total, anticipo y saldo, fecha límite de embarque, naviera, árbitro e incoterm;
* qué puede y qué no puede hacer el contrato con esos fondos.

El botón por defecto es "Rechazar", no "Firmar".

**T4.3 Bot de Telegram seguro (crítica 8).**
* Solo envía mensajes armados con plantillas y campos tipados: enums, montos y fechas. Nunca reenvía texto de un documento o de un correo.
* Responde solo a una lista de chats registrados.
* No firma nada: los botones abren la app.

**T4.4 Firma sin llave en el servidor.**
* Importador y exportador firman la orden desde su billetera (WalletConnect o una billetera de navegador), y los dueños proponen cambios al Delay con el SDK de Safe.
* En la demo pueden ser billeteras de prueba, pero **nunca** una llave en el servidor.

**T4.5 Vista del cosignatario.**
* Lista de cambios en cola, con su cuenta regresiva.
* Botón "Vetar" y botón de pánico "Revocar al agente".
* Depósitos de nivel 3 para cofirmar.
* No hay ningún botón para iniciar pagos, porque el rol no lo permite.

**T4.6 Avisos de operaciones retenidas y de plazos (crítica 19).**
Diseñar los mensajes de T2.6: qué pasó, por qué, cuánto falta para la fecha límite y qué puede hacer la persona. Incluye los avisos de depósito, anticipo, embarque, saldo, reembolso y alerta de cambio de cuenta.

**T4.7 Bitácora y panel de niveles.**
* Una línea por evento: estado, regla que decidió, nivel, enlace al PDR y a la transacción.
* Panel con los niveles 0 a 4 y el contador "órdenes liquidadas, ataques bloqueados, fondos perdidos: 0".

**T4.8 Textos en inglés y diseño de la demo.**
* Todos los textos de la interfaz en inglés, claros, sin jerga cripto.
* Coordinar con el Área 5 que cada acto de la demo se vea en una sola pantalla.

**T4.9 Perfiles y flujo de la orden (nueva).**
* Perfil de importador: crear una orden a partir de la proforma, firmarla, ver el depósito y el estado.
* Perfil de exportador: revisar y firmar la orden, ver que los fondos están depositados, subir el BL y la factura, ver el cobro.
* Vista de la orden con su estado en el escrow y la línea de tiempo: firmada, depositada, anticipo, embarcada, liquidada o reembolsada.

**T4.10 Disputa y cancelación (nueva, se recorta si falta tiempo).**
Botones para abrir una disputa y para cancelar de mutuo acuerdo, y una vista mínima para que el árbitro firme el reparto.

### Listo cuando

* Los cuatro actos de la demo se recorren desde la interfaz sin tocar la consola.
* Ninguna pantalla muestra una dirección completa sin identicon y nombre.
* El bot pasa la prueba de inyección del Área 5: un documento con instrucciones no aparece en ningún mensaje.

### Dependencias

* Recibe direcciones y ABIs del Área 1, estados del Área 2 y alertas del Área 3.
* Entrega capturas y la grabación al Área 5.

### Si falta tiempo

Se recortan la vista del árbitro (la disputa se muestra por script), la vista móvil y el alta con transferencia de prueba (queda una lista de proveedores precargada, y se declara). **Nunca** se recortan el diff legible de la orden, los dos perfiles ni la firma sin llave en el servidor.

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
* Actualizar el tablero con las tareas nuevas y retiradas de este documento.
* Puntos de integración de la sección 9.

**T5.2 Verificación de afirmaciones (crítica 16 y D9).**
Revisar cada cifra y afirmación antes de que entre al deck, y marcar con fuente o eliminar:
* incidente DRB y sus cifras;
* costo y demora de las transferencias internacionales (hoy la única fuente es la entrevista);
* "con China casi no se usa carta de crédito" (ídem);
* regulación de cripto en China continental y de stablecoins en Hong Kong;
* qué plataformas de comercio exterior sobre blockchain y de BL electrónico existen, antes de decir que algo no existe;
* "imposible para cualquiera" y "ninguno conocido".

Confirmar además si se puede citar al importador entrevistado.

**T5.3 Informe de autoevaluación de seguridad.**
* Tabla de niveles: nivel, qué cubre, dónde se hace cumplir (escrow, gate, Roles, motor o interfaz), prueba que lo demuestra y hash de evidencia. La construye con el Área 1.
* El nivel 4 se redacta con precisión: prohibido para el agente y el cosignatario; el dueño puede cambiar reglas solo vía Delay, y si no está el ConfigGuard, se declara que puede saltárselo.
* Lista de riesgos conocidos, sin "ninguno conocido":
  * contrato de escrow propio, sin auditoría de terceros;
  * configuración de Roles no auditada;
  * firmante de política en un servidor;
  * naviera y árbitro representados por llaves de prueba;
  * registro de partes administrado por Keel;
  * colusión de exportador y naviera;
  * el anticipo solo se recupera por disputa;
  * riesgo de emisor del token de pago;
  * verificación pública limitada en una red cerrada;
  * Telegram como canal;
  * la bitácora prueba lo registrado, no que nada se haya escapado.
* Tabla de llaves de T2.7.

**T5.4 Batería de red team (40 escenarios mínimo).**

| Categoría | Ejemplos |
|---|---|
| Cuenta de cobro | correo de cambio de cuenta; factura con otra cuenta; orden nueva con una dirección parecida |
| Documentos | BL fabricado; firma escaneada pegada; fecha *on board* alterada; monto alterado; texto oculto; homoglifos |
| Embarque | atestación firmada por otra llave; atestación de otra orden; mismo BL en dos órdenes; embarque tardío |
| Interfaz | inyección en un campo dirigida a Telegram; diff con direcciones parecidas |
| Llaves | relayer robado; firmante de política robado; uso del rol fuera del sistema |
| Escrow | retiro del importador; anticipo doble; reembolso anticipado; llamadas sobre estados finales; árbitro que intenta cobrar |
| Contrato | todos los casos de T1.7 ejecutados en la red de prueba |
| Alta de proveedor | alta con dirección falsa; verificación con monto equivocado |

Métricas:
* tasa de bloqueo de ataques;
* falsos positivos sobre los documentos legítimos;
* porcentaje de órdenes completadas sin intervención humana más allá de las firmas;
* latencia de decisión;
* **capa que detuvo cada ataque**: canal, extractor, motor, gate, Roles, escrow o humano.

**T5.5 Script de evidencia en cadena.**
Un comando que, sobre el despliegue final, genera y documenta con su hash:
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
* Documento técnico: arquitectura con diagrama, algoritmo central (escrow más motor más PDR más gate), diseño de seguridad y comparación honesta con el estado del arte.
* README: qué es, cómo desplegar, cómo correr las pruebas y la batería de red team, y enlaces a la evidencia.
* Mantener [flujo_clave.md](flujo_clave.md) al día cuando el equipo cierre una decisión abierta.

**T5.7 Deck y video.**
* Deck de 10 minutos con este orden: incidente DRB, problema del comercio exterior, idea central, arquitectura, cuatro actos, métricas, seguridad, alineación con WeBank, límites honestos.
* Video de 5 minutos con los cuatro actos grabados desde la app del Área 4, con narración en inglés.
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

| Día | Hito | Áreas clave |
|---|---|---|
| Lun 12 | Inicio. Interfaces del pago de cuentas congeladas. Repositorio con estructura. | 2, 5 |
| Mar 13 | **Cambio de rumbo.** Objetivo y flujo publicados en `flujo_clave.md`. Borrador de las interfaces nuevas. Tablero actualizado. | Todas |
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

Regla de trabajo: cada área trabaja en su carpeta y en sus propias ramas. Los cambios a `schemas/` los aprueba el Área 2, y los cambios a contratos ya desplegados, el Área 1.

---

## 10. Reglas de recorte globales

Si el viernes 16 el acto 1 no funciona de punta a punta, el Área 5 activa el recorte en este orden:

1. Disputa con vista del árbitro (queda por script, o como diseño).
2. Liberación diferida por ventana de disputa.
3. Registro de partes en cadena (queda una lista fija).
4. ConfigGuard (se declara el riesgo).
5. Monitor automático (queda el aviso humano).
6. Guía aérea y canal de correo (quedan el BL marítimo y la carga desde la app).
7. Alta de proveedor con transferencia de prueba (queda una lista precargada).

**Nunca caen:** TradeEscrow con sus cuatro invariantes, firma de la orden por ambas partes, atestación de embarque firmada, reembolso por vencimiento, PDRGate, rol AGENTE, extracción sin texto libre, cuatro actos de la demo, script de evidencia, informe de seguridad.

---

## 11. Mapa de críticas

Las críticas se recibieron sobre la propuesta de pago de cuentas. Así se trasladan al flujo de comercio exterior:

| # | Crítica | Área | Tarea |
|---|---|---|---|
| 8 | Texto libre en el esquema; eliminar el LLM operativo | 2, 3, 4 | D2, D3, T3.4, T4.3 |
| 9 | Onboarding con confianza ciega | 4 | T4.1 |
| 10 | Canal de entrada sin validar y solicitudes en masa | 3 | T3.1, T3.2 |
| 11 | Idempotencia evadible cambiando un píxel | 3, 1 | T3.7, T1.6, T1.9 |
| 12 | Tipo de cambio como superficie de ataque | 2 | Ya no aplica: el monto se pacta en el token (T2.3 retirada) |
| 13 | Custodia de llaves y botón de pánico | 2, 1 | T2.7, T2.8, T1.3 |
| 14 | Módulos auditados no implican configuración auditada | 1 | T1.7, T1.10 |
| 15 | Niveles 0 y 3 sin implementar; umbral global de la Safe; cosignatario que puede proponer | 1 | T1.3, T1.6 paso 8, D6 |
| 16 | Sobreafirmaciones | 5, 1 | D9, T5.2, T5.3, T1.5 |
| 17 | El humano firma direcciones hexadecimales | 4 | T4.2 |
| 18 | La simulación aporta poco para un transfer | 2 | D7, T2.5 |
| 19 | Fallar cerrado tiene costo real | 2, 4 | D8, T2.6, T4.6 |
| 1 a 7 | No incluidas en la captura | Por asignar | Por asignar |

**Nota sobre el nivel 0:** las lecturas (ver órdenes, documentos y bitácora) no firman nada. Se implementan como ausencia de capacidad: el lector no tiene llaves y el chat, si existe, no tiene herramientas que muevan fondos. En el informe se declara así, con la prueba de que el componente de lectura no tiene permisos en Roles.
