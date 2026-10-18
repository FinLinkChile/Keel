---
type: Área de trabajo
title: "Área 1: contratos y permisos en cadena"
description: "Objetivo, entregables y tareas T1.0 a T1.11: red y token, Safe, roles AGENTE y COSIGNATARIO, Delay, ConfigGuard, PDRGate, pruebas negativas, TradeEscrow e invariantes."
tags: [area-1, contratos, solidity, foundry, t1]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T20:30:00Z }
---

**Perfil sugerido:** quien tenga más experiencia en Solidity y Foundry.
**Objetivo:** que ni la IA, ni la llave del agente, ni el motor de política comprometido puedan pagar a quien no corresponde, y que cada nivel de permiso tenga una regla en cadena con su prueba. En Trade, además, que los fondos de una orden solo puedan ir al exportador o volver al importador, según las condiciones firmadas.

# Entregables

* Safe, Roles Modifier v2, Delay Modifier y PDRGate desplegados en la red elegida.
* TradeEscrow desplegado en la misma red (Trade).
* Batería de pruebas negativas, con fuzz e invariantes.
* `contracts/deployments/<chainId>.json` con todas las direcciones.
* Tabla "nivel → dónde se hace cumplir → prueba", que se entrega al Área 5.

# Tareas

**T1.0 Red y token (agregada por Trade, bloquea el resto).**
Elegir con el equipo la red cerrada y el token de pago. Confirmar que Safe y los módulos de Zodiac se pueden desplegar ahí y qué herramientas quedan disponibles (SDK, explorador). Si la red no tiene una stablecoin, desplegar un token de prueba y declararlo. Si Safe o Zodiac no se pueden desplegar, avisar el mismo día: cambia el diseño de permisos.

Red decidida el 16 de octubre: Base Sepolia (chainId 84532) para Trade y Personal, con las direcciones en `contracts/deployments/84532.json`. Token fijado el 18 de octubre: el USDC de prueba de Circle (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`, 6 decimales), con el riesgo de emisor declarado ([decisión 1](../decisiones/abiertas.md)).

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
* Aprobación exacta más `fund`, sin `fundWithPermit` (decisión 7, Área 1). El anticipo sale dentro de `fund` (decisión 2).

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
* Todo cambio de lista blanca (Personal), cupos, firmante de política y membresías se encola ahí (los proveedores conocidos y terceros de confianza de Trade tienen su propia espera en el gate, ver T1.11), con un enfriamiento de 3 minutos en la demo y 48 horas en el documento de producción, más una ventana de expiración.
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

**Trade (agregado):** `FundingGate` (`contracts/src/FundingGate.sol`), separado de PDRGate; los dos heredan `PDRVerifier`, que tiene la pausa, los firmantes, la versión de política, los nonces y la verificación del PDR (PDRGate quedó con el mismo comportamiento y el mismo ABI). La intención es `FundIntent`. `execute` revisa en este orden: pausa; `intentHash`; escrow y token de la intención; la orden guardada en el escrow (Abierta, `orderHash`, token, monto total, importador igual a la Safe); los registros de la Safe (T1.11); el hash del calldata, que el gate arma por dentro como `keccak256(abi.encode(approveData, fundData))` (vista `fundingCalldataOf`); el PDR; `approve` exacto y `fund` por el Roles, con el rol AGENTE en nivel 1 y con `AGENT_COSIGNED` (cupo mayor) en nivel 3 con cofirma; y que no quede aprobación al escrow. La idempotencia queda en el escrow: una orden solo se deposita desde Abierto. Emite `FundingExecuted(intentHash, pdrHash, tier, orderId)`. El cosignatario puede llamar directo `emergencyPause()` (solo pausa; reanudar es de la Safe). **[PROPUESTA del Área 1, pedido del Área 2 en #57]** Un `guardian` opcional, que fija la Safe con `setGuardian` (`address(0)` lo desactiva), también puede llamar `emergencyPause()` y nada más: no reanuda, no veta, no encola, no quita ni configura. Debe ser distinto del firmante de política, del cosignatario y de la Safe, y esos tampoco pueden pasar a ser el guardian. PDRGate no cambia (ABI y almacenamiento idénticos).

`setPolicySigner` y `setPolicyHash` solo pueden llamarse desde la Safe, y solo por el camino del Delay (T1.4). Las Áreas 1 y 2 decidieron un gate por modo ([PDR](../interfaces/pdr.md)).

**T1.7 Batería de pruebas negativas (crítica 14).**
Con Foundry y la configuración real de Roles. Cada caso debe revertir con el error esperado.

**Trade sobre fork (15 de octubre, Área 1):** `contracts/test/fork/` corre contra Base Sepolia en el bloque 48173000 con una Safe 1.4.1, una instancia del Zodiac Roles v2 real (el master `0xF2964CE6…83D5` es la versión 2.1.1, `gnosisguild/zodiac-modifier-roles` rama `v2`, commit `218a5164`, según su `mastercopies.json` y comparando el bytecode; no es el HEAD "contracts-v3"), USDC real, TradeEscrow y FundingGate. La configuración de los roles sale de `contracts/script/TradeRolesConfig.sol`, la misma fuente que usará el despliegue (T1.8); **[PROPUESTA]** su `configHash` (keccak256 de `abi.encode` de la lista ordenada de llamadas `(address, bytes)[]`, con el destino en cero) sería el `rolesConfigHash` del `policyHash` del Área 2. Es la identidad de la configuración prevista, no una prueba del estado en la cadena: el Roles v2 no permite enumerar destinos ni miembros, así que no cubre llamadas posteriores del dueño. Como incluye la dirección del gate y el gate recibe el `policyHash` en el constructor, al desplegar hay que predecir la dirección del gate o fijar el hash después con `setPolicyHash`. Las pruebas se saltan si falta `BASE_SEPOLIA_RPC_URL`. Diferencias del Roles real con el mock, corregidas en `MockTradeRoles` para los casos que usan las pruebas del gate (lo que el mock sigue sin emular está en su NatSpec): el orden de revisión es destino, función, opciones y condiciones; un spender distinto es `ParameterNotAllowed` (7), no `ParameterNotAMatch`; el `info` lleva el selector (`FunctionNotAllowed`) o la clave del cupo (`AllowanceExceeded`); quien no es módulo habilitado recibe `NotAuthorized(sender)` de Zodiac, no `NoMembership`.

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
* **Trade, script (16 de octubre, Área 1):** `contracts/script/DeployTrade.s.sol` despliega en Base Sepolia una Safe 1.4.1 (con el desplegador como dueño temporal), Roles 2.1.1 y Delay 1.1.0 (cooldown 180 s, expiración 1 día, el dueño como módulo del Delay) desde sus masters, `TradeEscrow` y `FundingGate`; aplica `TradeRolesConfig` y entrega la Safe a `OWNER_ADDRESS`. Se usa en tres pasos: simular; enviar con `--broadcast --slow` (cada transacción espera su recibo, así una que falle detiene las siguientes); y `record(safe, deployBlock)`, sin envío, que reconstruye todo desde la Safe en la cadena y comprueba dueños, umbral, módulos exactos de Safe, Roles y Delay, cupos (`maxRefill == refill`), firmantes, que el despliegue esté recién hecho y la membresía de los roles (por simulación). Solo si todo pasa escribe `deployments/84532.json` combinándolo con lo de `DeployPDRGate` (Trade escribe las claves de la raíz; Personal, `pdrGate` y `personal`), con `rolesConfigHash` y `rolesConfigCalls` para que el Área 2 los recalcule. El `policyHash` real lo fija la Safe por el Delay con `SetTradePolicy.s.sol` (el gate nace con uno provisional). Si un envío falla a mitad de camino, se vuelve a desplegar con otro `SALT_NONCE` y la Safe a medias se abandona. Antes de entregar la Safe, fija el guardian del gate (`GUARDIAN_ADDRESS`) y agrega como dueñas las que existan de `SECOND_OWNER_ADDRESS` y `THIRD_OWNER_ADDRESS` (las llaves de importador de las apps de las áreas 4 y 3, que firman órdenes por ERC-1271; cada una opcional); las comprobaciones finales exigen el guardian configurado, distinto de la Safe, los firmantes, el relayer y el desplegador, y los dueños exactos con umbral 1. Riesgo declarado: en la demo la Safe tiene hasta tres dueños con umbral 1, todos llaves de prueba, así que cualquiera de ellos controla la Safe por sí solo: mueve su USDC, quita a las otras dueñas, desactiva el Delay, reconfigura Roles, los registros, el guardian y el `policyHash`, y por ERC-1271 firma por el importador en el escrow (`open`, `approveBalance`, `cancel`). Sin ConfigGuard cualquier dueño se salta el Delay con una transacción directa de la Safe, así que ser `OWNER_ADDRESS` el único módulo del Delay no lo mitiga. Las dueñas extra tienen que ser llaves generadas en el dispositivo del usuario, nunca de servidor ([principios](../flujo/principios.md)); el script no puede exigirlo. `record` repite la validación de direcciones distintas, así que un `.env` con una dirección repetida no oculta a una dueña real. En el JSON `owners` va como `[OWNER_ADDRESS, SECOND_OWNER_ADDRESS, THIRD_OWNER_ADDRESS]` (las que existan); `getOwners()` de la Safe los devuelve en otro orden.

**T1.9 Contrato TradeEscrow (agregada por Trade, es su pieza central).**
Implementar la máquina de estados y la interfaz de [estados del escrow](../flujo/estados-del-escrow.md) y [datos firmados e interfaz](../flujo/datos-firmados-e-interfaz.md): `open`, `fund` (depósito y anticipo), `submitShipment`, `releaseBalance`, `approveBalance`, `refundAfterDeadline`, `raiseDispute`, `resolve`, `cancel`. El saldo se libera en dos pasos y una orden Embarcado no se reembolsa por vencimiento (decisión 3, [paso 5](../flujo/paso-5-saldo.md)). `open` exige que verificador, naviera y árbitro no sean una parte ni `payoutAddress`. **[HECHO]** en `contracts/src/TradeEscrow.sol`.
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

**T1.11 Registro de partes (agregada por Trade). [PROPUESTA del Área 1, 15 de octubre]**
Cubierta con registros por Safe dentro de `FundingGate`, en vez de un `PartyRegistry` administrado por Keel que revise `open`:
* Proveedores conocidos: el par (exportador, `payoutAddress`). Terceros de confianza: una dirección con roles NAVIERA (1), ÁRBITRO (2) y VERIFICADOR (4).
* `queueSupplier` y `queueThirdParty`: solo la Safe. El cambio cuenta desde `block.timestamp + configDelay` (inmutable, al menos `MIN_CONFIG_DELAY` = 60 segundos: 120 segundos en la demo, 48 horas en producción). Cada cambio recibe un `changeId` que es un contador, único para siempre.
* `vetoPending(changeId)`: la Safe o el cosignatario, solo mientras el cambio no se activa, y sin afectar otros cambios en cola. El cosignatario solo quita, nunca agrega.
* `removeSupplier` y `removeThirdParty`: solo la Safe, inmediatos.
* El gate rechaza un depósito cuyo proveedor o cuyos terceros no estén activos, en los dos niveles.
* Motivo: el veto del Delay (`setTxNonce`) cancela todo lo pendiente en bloque y, sin ConfigGuard, los dueños pueden saltárselo; aquí la espera la hace cumplir el contrato que paga.
* Fuera del alcance de la cadena: que la naviera y el árbitro sean empresas reales. En la demo son llaves de prueba, y se declara.
# Listo cuando

* Las pruebas de T1.7 pasan con `forge test`: al menos 25 casos negativos y 2 propiedades fuzz de Personal, y al menos 30 casos negativos de Trade.
* Las 4 invariantes de T1.10 pasan.
* Existe al menos un revert real en la red elegida por cada error tipado del gate y del escrow que se use en la demo.
* El Área 5 tiene la tabla de niveles y dónde se hace cumplir cada uno.

# Dependencias

* Necesita las estructuras de [interfaces](../interfaces/index.md) (Área 2), congeladas el miércoles 14.
* Entrega direcciones a las Áreas 2, 4 y 5 el jueves 15.

# Si falta tiempo

Se recorta en este orden: ConfigGuard (se declara el riesgo), recuperación social, liberación diferida por ventana de disputa, resolución 2 de 3. **Nunca** se recortan PDRGate, el rol AGENTE, la batería negativa, TradeEscrow con sus cuatro invariantes ni el reembolso por vencimiento.
