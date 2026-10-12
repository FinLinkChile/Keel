# Keel: división del trabajo en 5 áreas

**Proyecto:** Keel (antes Leash), pagador de cuentas básicas resistente a facturas fraudulentas
**Competencia:** 2026 Shenzhen FinTechathon, International Track, Topic F: Agent Wallet
**Cierre:** martes 20 de octubre, 23:59 hora de Beijing, que en Chile es **martes 20 a las 12:59**. Planificamos entregar el **lunes 19 a las 22:00** (hora de Chile) y dejar el martes como margen.
**Lema:** la IA interpreta una vez, el contrato obedece siempre.

---

## 0. Cómo leer este documento

1. **Decisiones transversales** (sección 1): lo que ya se definió y nadie cambia sin avisar al equipo.
2. **Interfaces compartidas** (sección 2): estructuras que se congelan el lunes 12 para que las 5 áreas trabajen en paralelo sin bloquearse.
3. **Las 5 áreas** (secciones 3 a 7): objetivo, entregables, tareas detalladas, criterio de "listo", críticas que resuelve, dependencias y qué se recorta si falta tiempo.
4. **Calendario, integración y reglas de recorte** (secciones 8 a 10).
5. **Mapa de críticas** (sección 11): cada crítica recibida, con el área y la tarea que la resuelve.

Las críticas 1 a 7 no venían en la captura que revisé; esta propuesta cubre de la 8 a la 19. Cuando lleguen las anteriores, se asignan con el mismo formato.

---

## 1. Decisiones transversales (válidas para todas las áreas)

| # | Decisión | Por qué |
|---|---|---|
| D1 | El proyecto se llama **Keel** en código, documentos, repositorio y deck. No queda ninguna mención a "Leash". | Hay un repositorio competidor del mismo tema con ese nombre. |
| D2 | **Se elimina el LLM operativo.** El flujo queda así: extractor LLM en cuarentena, validador determinista, motor de política, PDR, contrato. Si existe un chat, es de solo lectura (nivel 0) y explica decisiones con plantillas. | Crítica 8: el motor ya es determinista y ese LLM solo agrega superficie de ataque. |
| D3 | **El esquema de extracción no tiene texto libre.** Solo enums, números y campos validados con expresiones regulares. | Crítica 8. |
| D4 | **PDRGate es el único miembro del rol del agente** en el Roles Modifier. La llave del agente sola no puede mover fondos: solo sirve para pagar gas. | Sin esto, el PDR no se exige en cadena y Keel quedaría igual que el competidor. |
| D5 | **Los cambios de configuración pasan por el Delay Modifier:** lista blanca, cupos, firmante de la política y miembros de roles. Tienen aviso y ventana de veto. | Hace verificable el nivel 2 y responde a la crítica 16. |
| D6 | **El cosignatario no es dueño de la Safe.** Tiene un rol propio que solo le permite vetar, pausar y revocar el rol del agente. | Crítica 15: en una Safe, cualquier dueño puede proponer. |
| D7 | **La simulación en tiempo de ejecución es `eth_call`.** Anvil se usa solo para las pruebas con fork. | Crítica 18. |
| D8 | **Fallar cerrado siempre avisa:** todo pago retenido notifica el motivo, la fecha de vencimiento y la alternativa manual. | Crítica 19. |
| D9 | **Nada de sobreafirmaciones.** Ninguna celda dice "ninguno conocido" ni "imposible para cualquiera". Cada afirmación de seguridad dice para quién vale, dónde se hace cumplir y qué prueba lo demuestra. | Crítica 16. |
| D10 | Todo lo que se entrega al jurado va en inglés. El trabajo interno puede ir en español. | Bases del concurso. |

---

## 2. Interfaces compartidas (se congelan el lunes 12 a las 20:00)

El Área 2 es dueña de estas definiciones. Viven en `schemas/`, como JSON Schema y tipos TypeScript (zod), y como structs en Solidity. Cambiarlas después del congelamiento exige avisar a las 5 áreas.

### 2.1 Extracción de factura (salida del extractor en cuarentena)

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

### 2.2 Intención (TIS de Keel)

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

### 2.3 Decisión (PDR de Keel)

```solidity
struct PolicyDecision {
    bytes32 intentHash;     // hash EIP 712 de PaymentIntent
    bytes32 calldataHash;   // keccak256 del calldata exacto de USDC.transfer
    bytes32 policyHash;     // versión vigente de las reglas
    bytes32 inputsHash;     // tipo de cambio, fuentes, versión de lista blanca
    uint8   tier;           // 1 o 3 (los niveles 0, 2 y 4 no llegan al gate)
    uint64  expiresAt;
}
```

* Dominio EIP 712: `name = "Keel"`, `version = "1"`, `chainId`, `verifyingContract = PDRGate`.
* El PDR completo, en JSON con las reglas evaluadas y sus resultados, se guarda fuera de cadena en `evidence/pdr/<intentHash>.json`. En cadena va su hash, dentro del evento del gate.

### 2.4 Eventos y errores tipados (nombres fijos)

* Eventos: `PaymentExecuted`, `PaymentHeld`, `BeneficiaryChangeQueued`, `BeneficiaryChangeVetoed`, `AgentRoleRevoked`, `GatePaused`.
* Errores: `IntentMismatch`, `CalldataMismatch`, `BadPolicySignature`, `MissingCosignature`, `StalePolicy`, `Expired`, `NonceUsed`, `InvoiceAlreadyPaid`, `GateIsPaused`.

### 2.5 Estructura del repositorio

```
contracts/   Solidity, Foundry, scripts de despliegue          (Área 1)
schemas/     JSON Schema, tipos TS, structs EIP 712             (Área 2)
engine/      motor de política, PDR, firmas, verificador        (Área 2)
ingest/      correo, PDF, extractor, idempotencia               (Área 3)
app/         web: onboarding, diff legible, cosignatario         (Área 4)
bot/         bot de Telegram con plantillas                     (Área 4)
redteam/     escenarios, corpus adversarial, métricas           (Área 5)
docs/        documento técnico, seguridad, evidencia, deck      (Área 5)
```

---

## 3. Área 1: Contratos y permisos en cadena

**Perfil sugerido:** quien tenga más experiencia en Solidity y Foundry.
**Objetivo:** que ni la IA, ni la llave del agente, ni el motor de política comprometido puedan pagar a quien no corresponde. Y que cada nivel de permiso tenga una regla en cadena con su prueba.

### Entregables

* Safe, Roles Modifier v2, Delay Modifier y PDRGate desplegados y verificados en Base Sepolia.
* Batería de pruebas negativas sobre fork, con fuzz e invariantes.
* `contracts/deployments/84532.json` con todas las direcciones.
* Tabla "nivel → dónde se hace cumplir → prueba", que se entrega al Área 5.

### Tareas

**T1.1 Safe base.**
Desplegar una Safe en Base Sepolia con el dueño como único firmante (1 de 1) para la demo. Documentar que en producción sería 2 de 3, con recuperación social. El cosignatario **no** se agrega como dueño (D6).

**T1.2 Rol AGENTE en el Roles Modifier.**
* Miembro único: la dirección de PDRGate (D4).
* Destino permitido: solo el contrato USDC de Base Sepolia.
* Función permitida: solo `transfer(address,uint256)`.
* Condición sobre el destinatario: igual a alguna dirección de la lista blanca vigente.
* Condición sobre el monto: dentro de un cupo (allowance) por periodo, por ejemplo mensual, con recarga automática.
* Opciones de ejecución: sin `delegatecall` y sin `value`.
* Armar la configuración con el SDK de Zodiac Roles para no escribir a mano la codificación de condiciones. Guardar la configuración como archivo versionado: su hash es el `policyHash` de la parte en cadena.

**T1.3 Rol COSIGNATARIO en el Roles Modifier.**
* Miembro: la llave del cosignatario.
* Funciones permitidas y nada más:
  * vetar un cambio en cola (invalidar la transacción pendiente en el Delay Modifier);
  * revocar la membresía de PDRGate en el rol AGENTE (botón de pánico);
  * pausar PDRGate.
* Con esto, "el cosignatario no puede iniciar envíos" pasa a ser cierto a nivel de protocolo, no solo de interfaz (crítica 15).

**T1.4 Delay Modifier para cambios de configuración.**
* Habilitarlo como módulo de la Safe.
* Todo cambio de lista blanca, cupos, firmante de política y membresías se encola ahí, con un enfriamiento de 3 minutos en la demo y 48 horas en el documento de producción, más una ventana de expiración.
* Definir con el Área 4 cómo el dueño propone el cambio desde su billetera.
* Este es el **nivel 2** en cadena.

**T1.5 ConfigGuard (prioridad media, se recorta si falta tiempo).**
* Guard de transacciones de la Safe que rechaza llamadas directas del dueño hacia Roles, Delay y PDRGate. Así, esos cambios solo pueden llegar por el camino del Delay.
* Sin este guard, el dueño puede saltarse el retraso, y eso **debe declararse** en el informe de seguridad (D9, crítica 16).
* Probar a fondo: un guard defectuoso puede bloquear la Safe. Incluir una prueba de que el dueño todavía puede operar por el camino legítimo.

**T1.6 Contrato PDRGate.**
`execute(PaymentIntent intent, PolicyDecision d, bytes sigPolicy, bytes sigCosigner)` hace, en este orden:
1. Rechaza si está pausado (`GateIsPaused`).
2. Recalcula el hash EIP 712 de la intención y lo compara con `d.intentHash` (`IntentMismatch`).
3. Construye el calldata **dentro del contrato**, con `abi.encodeCall(IERC20.transfer, (intent.recipient, intent.amountUsdc))`, y compara su hash con `d.calldataHash` (`CalldataMismatch`).
4. Verifica que `sigPolicy` venga del firmante de política registrado (`BadPolicySignature`).
5. Verifica `d.policyHash == currentPolicyHash` (`StalePolicy`).
6. Verifica expiración y fecha límite (`Expired`).
7. Verifica y consume el nonce (`NonceUsed`).
8. Verifica y marca `invoiceKey` como pagada (`InvoiceAlreadyPaid`). La idempotencia queda en cadena, así que ni un motor comprometido puede pagar dos veces la misma factura (crítica 11).
9. Si `d.tier == 3`, exige una firma válida del cosignatario sobre el mismo digest (`MissingCosignature`). Así se implementa el umbral por monto que la Safe no tiene (crítica 15).
10. Ejecuta a través del Roles Modifier con el rol AGENTE. Los límites de Roles se siguen aplicando aunque todo lo anterior pase: es la defensa en profundidad.
11. Emite `PaymentExecuted(intentHash, pdrHash, tier, invoiceKey)`.

`setPolicySigner` y `setPolicyHash` solo pueden llamarse desde la Safe, y solo por el camino del Delay (T1.4).

**T1.7 Batería de pruebas negativas sobre fork (crítica 14).**
Con Foundry sobre un fork de Base Sepolia y la configuración real de Roles. Cada caso debe revertir con el error esperado:

| Grupo | Casos |
|---|---|
| Rol mal usado | `delegatecall`; `value` mayor que cero; otro token; `approve`; `transferFrom`; `increaseAllowance`; destinatario fuera de la lista; monto sobre el cupo del periodo |
| MultiSend | Llamadas empaquetadas con relleno al final (la falla conocida del desensamblador); llamada anidada al Roles Modifier |
| Escalada | Agente que intenta cambiar la configuración de Roles; agente que intenta asignarse roles; cosignatario que intenta transferir; cosignatario que intenta cambiar la lista |
| PDR | Calldata distinto del aprobado; intención alterada en un byte; firma de otro firmante; política vieja; PDR expirado; nonce repetido; factura ya pagada; nivel 3 sin cosignatario |
| Pausa y pánico | Pago con el gate en pausa; pago después de revocar el rol |

Agregar dos propiedades fuzz:
* Para cualquier secuencia de llamadas del agente, la salida del periodo es menor o igual al cupo.
* Ninguna secuencia transfiere a una dirección fuera de la lista.

**T1.8 Despliegue y verificación.**
Script de despliegue reproducible, contratos verificados en Basescan y un archivo de direcciones que consumen las demás áreas. Coordinar con el Área 5 la cuenta de faucet y los fondos de prueba.

### Listo cuando

* Las pruebas de T1.7 pasan con `forge test`, con al menos 25 casos negativos y 2 propiedades fuzz.
* Existe al menos un revert real en Base Sepolia por cada error tipado del gate.
* El Área 5 tiene la tabla de niveles y dónde se hace cumplir cada uno.

### Dependencias

* Necesita las estructuras de la sección 2 (Área 2), congeladas el lunes 12.
* Entrega direcciones a las Áreas 2, 4 y 5 el miércoles 14.

### Si falta tiempo

Se recorta en este orden: ConfigGuard (se declara el riesgo), recuperación social, prueba en FISCO BCOS. **Nunca** se recortan PDRGate, el rol AGENTE ni la batería negativa.

---

## 4. Área 2: Motor de política, PDR, tipo de cambio y claves

**Perfil sugerido:** backend en TypeScript con interés en criptografía.
**Objetivo:** convertir una factura validada en una decisión determinista, reproducible y firmada, que el contrato pueda verificar. Además, ser dueño de las interfaces y de la custodia de llaves.

### Entregables

* `schemas/` congelado el lunes 12.
* `engine/` con función pura de evaluación, emisión de PDR y firma EIP 712.
* Módulo de tipo de cambio con dos fuentes.
* Verificador reproducible por línea de comandos.
* Tabla de custodia de llaves y procedimiento de rotación.

### Tareas

**T2.1 Congelar interfaces (lunes 12).**
Escribir los esquemas de la sección 2 en JSON Schema, zod y Solidity, con pruebas de que las tres versiones calculan el mismo hash para el mismo dato. Si TypeScript y Solidity no coinciden byte a byte, el gate rechaza todo.

**T2.2 Motor determinista.**
`evaluate(extraction, context) → { tier, rules[], intent }` como función pura: sin red, sin LLM y sin reloj implícito (la hora entra como parámetro). Cada regla devuelve el nivel mínimo que fuerza y el nivel final es el máximo. Reglas iniciales:

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

Cada regla debe tener su prueba unitaria. Las reglas se versionan, y el hash del archivo de reglas más el hash de la configuración de Roles forman el `policyHash`.

**T2.3 Tipo de cambio (crítica 12).**
* La factura viene en pesos y el pago se hace en USDC.
* Usar dos fuentes: el dólar observado del Banco Central (por ejemplo, vía mindicador.cl) y la cotización de un exchange local de referencia (Buda u Orionx).
* Si divergen más de un 1,5%, la factura se retiene y se avisa.
* El monto en USDC se calcula con la tasa menos favorable más un margen fijo declarado.
* La tasa, las dos fuentes y la hora de consulta entran al `inputsHash` del PDR.
* En la demo en testnet las fuentes pueden fijarse con valores grabados, pero el código y la regla deben ser los reales.
* El cupo en USDC del Roles Modifier acota el peor caso aunque alguien manipule la fuente. Esto se documenta como control.

**T2.4 Emisión y firma del PDR.**
* Construir el calldata exacto, calcular `calldataHash`, armar `PolicyDecision` y firmarla con la llave de política (EIP 712).
* Para nivel 3, generar el digest que debe firmar el cosignatario y entregarlo al Área 4.
* Guardar el JSON completo del PDR en `evidence/pdr/`.

**T2.5 Simulación previa (crítica 18).**
`eth_call` de la llamada exacta al gate antes de enviarla. Si revierte, el pago queda retenido con su motivo y no se gasta gas. Anvil queda solo para las pruebas.

**T2.6 Estados del pago y aviso al fallar cerrado (crítica 19).**
* Estados: `pagado`, `retenido`, `en_aprobacion`, `cambio_en_cola`, `bloqueado`.
* Un programador revisa cada día los pagos retenidos y avisa (vía el bot del Área 4) a 5, 3 y 1 día del vencimiento, con el motivo y las instrucciones de pago manual.

**T2.7 Custodia y rotación de llaves (crítica 13).**
Escribir y aplicar esta tabla:

| Llave | Qué puede hacer | Si la roban | Mitigación | Rotación |
|---|---|---|---|---|
| Relayer del agente | Pagar gas y llamar al gate | Nada sin un PDR válido | Saldo mínimo de ETH | Libre, sin Delay |
| Firmante de política | Firmar PDR | Puede aprobar pagos dentro de Roles: lista blanca y cupo | Proceso separado, monitoreo, cupo de Roles | `setPolicySigner` vía Delay |
| Cosignatario | Vetar, pausar, revocar | Puede detener pagos, no robar | Rol mínimo | El dueño la reemplaza vía Delay |
| Dueño | Configurar vía Delay | Cambios visibles y vetables durante el enfriamiento | Delay y ConfigGuard | Recuperación de la Safe |
| Token del bot | Enviar mensajes | Mensajes falsos | Plantillas, lista de chats; el bot no firma nada | Regenerar en BotFather |
| API del LLM | Extraer facturas | Costo y abuso, no fondos | Variables de entorno, límite de gasto | Regenerar |

Para la demo, las llaves viven en archivos `.env` fuera del repositorio. En el documento se declara KMS o HSM como camino a producción.

**T2.8 Monitor de uso fuera del sistema (crítica 13).**
* Un vigía escucha los eventos del Roles Modifier y del gate.
* Si aparece una ejecución con el rol AGENTE que no corresponde a ningún PDR emitido por el motor, llama automáticamente al botón de pánico: revoca el rol (T1.3) usando la llave del cosignatario automático, o avisa al cosignatario humano.
* Es el cierre del acto 4.

**T2.9 Verificador reproducible.**
`keel verify <txHash>`:
1. Lee el evento.
2. Busca el PDR por su hash.
3. Recalcula la decisión con las mismas entradas y la misma versión de reglas.
4. Compara todos los hashes y muestra "coincide" o la diferencia exacta.

Es la herramienta que se le muestra al jurado para pasar de "tenemos logs" a "nuestras decisiones son verificables".

### Listo cuando

* Las interfaces están congeladas y probadas en TS y Solidity.
* El motor tiene una prueba unitaria por regla y pasa el corpus del Área 3.
* El verificador reproduce al menos 5 decisiones reales de testnet.
* La tabla de llaves está en el informe de seguridad.

### Dependencias

* Recibe direcciones del Área 1 (miércoles 14) y extracciones del Área 3.
* Entrega PDR firmados al Área 1 para pruebas y avisos al Área 4.

### Si falta tiempo

Se recorta el monitor automático (queda solo como aviso humano) y una de las dos fuentes de tipo de cambio (se declara). **Nunca** se recortan la firma EIP 712, el verificador ni la idempotencia.

---

## 5. Área 3: Ingesta de facturas y extracción en cuarentena

**Perfil sugerido:** backend con experiencia en LLM, parsing de PDF y correo.
**Objetivo:** que nada de lo que llega en un correo o en un PDF pueda convertirse en una dirección de pago, y que las facturas legítimas se extraigan con la exactitud suficiente para pagar solas.

### Entregables

* `ingest/` con canal de correo autenticado, parser determinista, extractor en cuarentena y comparación entre ambos.
* Detección de cambio de beneficiario que abre solicitudes y nunca pagos.
* Corpus de facturas legítimas y adversariales con etiquetas correctas.

### Tareas

**T3.1 Canal de entrada autenticado (crítica 10).**
* Usar una casilla dedicada, por ejemplo con reenvío de correo a un webhook.
* Para cada correo, validar SPF, DKIM y DMARC, y comparar el dominio alineado con el dominio registrado para ese alias en el onboarding.
* Si falla, el correo queda en cuarentena y no se procesa. Se registra en la bitácora con el motivo.

**T3.2 Protección contra inundación (crítica 10).**
* Máximo una solicitud de cambio de beneficiario pendiente por alias.
* Límite de correos por remitente y por día.
* Duplicados descartados automáticamente.
* Enfriamiento de 7 días tras un cambio rechazado o vetado.
* Las solicitudes se agrupan en un resumen diario en vez de notificarse una por una.
* Objetivo: que nadie firme por cansancio.

**T3.3 Parser determinista.**
* Extraer el texto del PDF y aplicar expresiones regulares para RUT, folio, periodo, monto y vencimiento.
* Detectar texto oculto: color igual al fondo, tamaño menor a 4 puntos, fuera del área visible, capas superpuestas.
* Normalizar homoglifos (caracteres de otros alfabetos que se ven iguales) antes de comparar.

**T3.4 Extractor LLM en cuarentena.**
* Sin herramientas, temperatura 0 y salida estructurada con el esquema estricto de la sección 2.1.
* El modelo elige `alias_id` de un enum y nunca produce direcciones.
* Si el documento menciona una cuenta o billetera nueva, solo marca `mentions_account_change = true`. Las direcciones encontradas las extrae el parser determinista y van **exclusivamente** al flujo de cambio de beneficiario (T3.6).
* Todo lo que no calce con el esquema se descarta y la factura queda retenida.

**T3.5 Concordancia de dos fuentes.**
* El extractor y el parser deben coincidir en RUT, folio, periodo y monto.
* Si hay diferencia, la factura queda en nivel 3, con aviso que muestra los dos valores.
* Así se cubre el límite que reconoce el propio documento: un LLM manipulado puede devolver un valor falso dentro de un esquema válido.

**T3.6 Detección de cambio de beneficiario.**
* Genera una solicitud de cambio, no un pago.
* La solicitud incluye: dirección anterior y nueva, fuente, resultado de SPF/DKIM y hash del documento.
* La pasa al Área 4 (diff legible) y, si el dueño la confirma, al Delay del Área 1.

**T3.7 Clave de idempotencia (crítica 11).**
* `invoiceKey = keccak256(issuer_tax_id, invoice_number, period)`, calculada con los valores normalizados.
* Reemplaza al hash del PDF, que se evade cambiando un píxel.
* Se deduplica al ingresar y además se hace cumplir en cadena (T1.6, paso 8).

**T3.8 Corpus de facturas.**
* **Legítimas:** al menos 12, anonimizadas: luz, agua, internet, arriendo y gastos comunes, de 3 periodos distintos.
* **Adversariales:** al menos 25 variantes: cuenta cambiada con el mismo formato, texto blanco con instrucciones, letra diminuta, homoglifos en el RUT, monto alterado, folio repetido con otro píxel, remitente falso que falla DKIM, correo legítimo reenviado con un adjunto cambiado, inyección en el campo del emisor.
* Cada caso lleva su resultado esperado. El corpus lo usa el Área 5 para medir.

### Listo cuando

* Las 12 facturas legítimas se extraen bien de punta a punta.
* Ninguna variante adversarial produce un pago.
* Ningún dato del documento llega a un mensaje de Telegram ni a un PDR fuera de los campos tipados.

### Dependencias

* Recibe el esquema del Área 2 el lunes 12 y la tabla de alias con dominios del Área 4.
* Entrega extracciones al Área 2 y el corpus al Área 5 el viernes 16.

### Si falta tiempo

Se recortan el resumen diario (queda solo el límite de solicitudes pendientes) y la detección de capas superpuestas. **Nunca** se recortan el esquema sin texto libre, la concordancia de dos fuentes ni la validación SPF/DKIM.

---

## 6. Área 4: Producto, onboarding y canal humano

**Perfil sugerido:** frontend o full stack con criterio de producto y UX.
**Objetivo:** que la persona entienda lo que firma sin leer hexadecimal, que el primer registro de un beneficiario no sea confianza ciega y que el cosignatario pueda frenar sin poder robar.

### Entregables

* App web: onboarding, libreta de beneficiarios, diff legible de cambios, vista del cosignatario, bitácora y panel de niveles.
* Bot de Telegram con mensajes de plantilla y enlaces de firma.
* Firma del dueño desde su propia billetera, sin llaves en el servidor.

### Tareas

**T4.1 Onboarding con verificación fuera de banda (crítica 9).**
1. El usuario registra un beneficiario: alias, nombre, RUT, dominio de correo esperado y dirección USDC.
2. Keel envía una **transferencia de prueba** de un monto aleatorio pequeño, por ejemplo 0,37 USDC.
3. El usuario le pide al beneficiario, por teléfono o en persona, que le confirme el monto exacto recibido, y lo ingresa en la app.
4. Solo si coincide, la dirección se marca como verificada y se encola su alta en la lista blanca a través del Delay.

El resultado de la verificación (monto, fecha y canal) se guarda como hash en la bitácora. En el deck esto se compara con los microdepósitos que usan los bancos.

**T4.2 Diff legible para cambios de beneficiario (crítica 17).**
Pantalla con:
* alias y nombre;
* **cuenta anterior** en grupos cortos con identicon, fecha de verificación y pagos realizados;
* **cuenta nueva** con identicon, "vista por primera vez hoy", fuente (correo de X) y resultado de SPF/DKIM;
* qué cambia en el contrato y cuándo termina el enfriamiento.

Antes de firmar, exige el paso de verificación por otro canal (T4.1). El botón por defecto es "Rechazar", no "Aprobar".

**T4.3 Bot de Telegram seguro (crítica 8).**
* Solo envía mensajes armados con plantillas y campos tipados: enums, montos y fechas. Nunca reenvía texto del correo o del PDF.
* Responde solo a una lista de chats registrados.
* No firma nada: los botones abren la app web, donde firma la billetera del dueño.
* El token se guarda como se define en T2.7.

**T4.4 Firma del dueño sin llave en el servidor.**
* El dueño firma desde su billetera en el navegador (WalletConnect o una billetera de navegador) y propone transacciones al Delay con el SDK de Safe.
* En la demo puede ser una billetera de prueba en el navegador, pero **nunca** una llave en el servidor.
* Esto separa a Keel del competidor, que reconoce tener la llave del dueño en el servidor.

**T4.5 Vista del cosignatario.**
* Lista de cambios en cola, con el diff legible y su cuenta regresiva.
* Botón "Vetar" y botón de pánico "Revocar al agente": cada uno es una sola transacción con el rol COSIGNATARIO (T1.3).
* Solicitudes de nivel 3 para cofirmar.
* No hay ningún botón para iniciar pagos, porque el rol no lo permite.

**T4.6 Avisos de pagos retenidos (crítica 19).**
Diseñar los mensajes de T2.6: qué pasó, por qué, cuánto falta para el vencimiento y cómo pagar manualmente si es urgente. Probarlos con 2 personas ajenas al equipo.

**T4.7 Bitácora y panel de niveles.**
* Una línea por intento: estado (pagado, retenido, en cola, vetado, revertido en cadena), regla que decidió, nivel, enlace al PDR y enlace a Basescan.
* Panel con los niveles 0 a 4 y el contador "facturas pagadas, ataques bloqueados, fondos perdidos: 0".
* Se usa en la demo y en las capturas.

**T4.8 Textos en inglés y diseño de la demo.**
* Todos los textos de la interfaz en inglés, claros, sin jerga cripto: montos en pesos con su equivalente en USDC.
* Coordinar con el Área 5 que cada acto de la demo se vea en una sola pantalla.

### Listo cuando

* Los cuatro actos de la demo se recorren desde la interfaz sin tocar la consola.
* Ninguna pantalla muestra una dirección completa sin identicon y alias.
* El bot pasa la prueba de inyección del Área 5: un emisor con instrucciones no aparece en ningún mensaje.

### Dependencias

* Recibe direcciones y ABIs del Área 1, estados del Área 2 y solicitudes de cambio del Área 3.
* Entrega capturas y la grabación al Área 5.

### Si falta tiempo

Se recortan la prueba con personas externas y la vista móvil. **Nunca** se recortan el diff legible, la verificación fuera de banda ni la firma sin llave en el servidor.

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

**T5.1 Coordinación (desde el lunes 12).**
* Inscribir al equipo y confirmar que se cumple el requisito de al menos 60% de integrantes no chinos.
* Enviar el correo a la organización (wangyr@pbcsf.tsinghua.edu.cn) con dos preguntas: si testnet cuenta como transacciones reales y si el cierre es el 20 de octubre o el 2 de noviembre.
* Reunión diaria de 15 minutos a la misma hora.
* Tablero con las tareas de este documento.
* Puntos de integración de la sección 9.

**T5.2 Verificación de afirmaciones (crítica 16 y D9).**
Revisar cada cifra y afirmación del documento técnico antes de que entre al deck, y marcar con fuente o eliminar:
* incidente DRB y sus cifras;
* Neat Pagos;
* crecimiento de Cobre;
* "ningún competidor ataca el fraude de facturas". Reformular: el repositorio Leash ya trata facturas con cambio de datos.
* "imposible para cualquiera".
* "ninguno conocido".

**T5.3 Informe de autoevaluación de seguridad.**
* Tabla de niveles: nivel, qué cubre, dónde se hace cumplir (contrato, gate, motor o interfaz), prueba que lo demuestra y hash de evidencia. La construye con el Área 1.
* El nivel 4 se redacta con precisión: imposible para el agente y el cosignatario; el dueño puede cambiar reglas solo vía Delay, con aviso y veto, y si no está el ConfigGuard, se declara que puede saltárselo.
* Lista de riesgos conocidos, sin "ninguno conocido":
  * configuración de Roles no auditada por terceros;
  * firmante de política en un servidor;
  * fuentes del tipo de cambio;
  * puente fiat centralizado;
  * riesgo de emisor y congelamiento de USDC;
  * Telegram como canal;
  * la bitácora prueba lo registrado, no que nada se haya escapado.
* Tabla de llaves de T2.7.

**T5.4 Batería de red team (40 escenarios mínimo).**
Categorías, con casos de las críticas incluidos:

| Categoría | Ejemplos |
|---|---|
| Factura | cuenta cambiada; texto oculto; homoglifos; monto alterado; folio repetido con otro píxel |
| Correo | remitente falso sin DKIM; inundación de solicitudes; reenvío con adjunto cambiado |
| Interfaz | inyección en campo de emisor dirigida a Telegram; diff con direcciones parecidas |
| Tipo de cambio | fuente manipulada; divergencia entre fuentes |
| Llaves | relayer robado; firmante de política robado; uso del rol fuera del sistema |
| Contrato | todos los casos de T1.7 ejecutados en testnet |
| Onboarding | alta con dirección falsa; verificación con monto equivocado |

Métricas:
* tasa de bloqueo de ataques;
* falsos positivos sobre las facturas legítimas;
* porcentaje de facturas pagadas sin intervención humana;
* latencia de decisión;
* **capa que detuvo cada ataque**: correo, extractor, motor, gate, Roles o humano.

La última métrica es la que mejor muestra la defensa en profundidad.

**T5.5 Script de evidencia en cadena.**
Un comando que, sobre el despliegue final, genera y documenta con su hash:
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

**T5.6 Documento técnico y README.**
* Documento técnico: arquitectura con diagrama, algoritmo central (motor más PDR más gate), diseño de seguridad y comparación honesta con el estado del arte (Leash, Coinbase, Cobo, Safe con Roles, PACE).
* README: qué es, cómo desplegar, cómo correr las pruebas y la batería de red team, y enlaces a la evidencia.

**T5.7 Deck y video.**
* Deck de 10 minutos con este orden: incidente DRB, problema, idea central, arquitectura, cuatro actos, métricas, seguridad, alineación con WeBank, límites honestos.
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

## 8. Calendario (hora de Chile)

| Día | Hito | Áreas clave |
|---|---|---|
| Lun 12 | Inicio. Interfaces congeladas a las 20:00. Repositorio con estructura. Correo a la organización. | 2, 5 |
| Mar 13 | Rol AGENTE y PDRGate en pruebas locales. Motor con las primeras reglas. Parser y extractor sobre 3 facturas. Esqueleto de la app. | 1, 2, 3, 4 |
| Mié 14 | **Despliegue v1 en Base Sepolia y primer revert real.** Firma EIP 712 compatible entre TS y Solidity. | 1, 2 |
| Jue 15 | Delay y rol COSIGNATARIO. Concordancia de dos fuentes. Onboarding con transferencia de prueba. | 1, 3, 4 |
| Vie 16 | **Integración de punta a punta: acto 1 en testnet.** Corpus completo entregado. Primera corrida de red team. | Todas |
| Sáb 17 | Actos 2, 3 y 4 funcionando. Monitor y botón de pánico. Diff legible. Borradores de documentos. | Todas |
| Dom 18 | **Congelamiento de funciones a las 20:00.** Despliegue final. Script de evidencia. Ensayo general. | Todas |
| Lun 19 | Documentos, deck y video finales. **Entrega a las 22:00.** | 5 con apoyo de todos |
| Mar 20 | Margen. Cierre oficial a las 12:59. | 5 |

---

## 9. Puntos de integración

1. **Lunes 12, 20:00:** congelamiento de interfaces (Área 2 con todas).
2. **Miércoles 14:** direcciones y ABIs publicados (Área 1 hacia 2, 4 y 5).
3. **Viernes 16:** un pago real de punta a punta: correo, extracción, motor, PDR, gate, Roles y USDC, visible en la bitácora.
4. **Domingo 18:** despliegue final. Después de esto no se cambian contratos, solo documentos.

Regla de trabajo: cada área trabaja en su carpeta y en sus propias ramas. Los cambios a `schemas/` los aprueba el Área 2, y los cambios a contratos ya desplegados, el Área 1.

---

## 10. Reglas de recorte globales

Si el viernes 16 el acto 1 no funciona de punta a punta, el Área 5 activa el recorte en este orden:

1. Exploración en FISCO BCOS.
2. Transacciones en Base mainnet.
3. ConfigGuard (se declara el riesgo).
4. Monitor automático (queda el aviso humano).
5. Segunda fuente de tipo de cambio (se declara).
6. Resumen diario de solicitudes.

**Nunca caen:** PDRGate, rol AGENTE, Delay para cambios, cosignatario con veto, extracción sin texto libre, cuatro actos de la demo, script de evidencia, informe de seguridad.

---

## 11. Mapa de críticas

| # | Crítica | Área | Tarea |
|---|---|---|---|
| 8 | Texto libre en el esquema; eliminar el LLM operativo | 2, 3, 4 | D2, D3, T3.4, T4.3 |
| 9 | Onboarding con confianza ciega | 4 | T4.1 |
| 10 | Correo sin validar y solicitudes en masa | 3 | T3.1, T3.2 |
| 11 | Idempotencia evadible cambiando un píxel | 3, 1 | T3.7, T1.6 paso 8 |
| 12 | Tipo de cambio como superficie de ataque | 2 | T2.3 |
| 13 | Custodia de llaves y botón de pánico | 2, 1 | T2.7, T2.8, T1.3 |
| 14 | Módulos auditados no implican configuración auditada | 1 | T1.7 |
| 15 | Niveles 0 y 3 sin implementar; umbral global de la Safe; cosignatario que puede proponer | 1 | T1.3, T1.6 paso 9, D6 |
| 16 | Sobreafirmaciones | 5, 1 | D9, T5.2, T5.3, T1.5 |
| 17 | El humano firma direcciones hexadecimales | 4 | T4.2 |
| 18 | La simulación aporta poco para un transfer | 2 | D7, T2.5 |
| 19 | Fallar cerrado tiene costo real | 2, 4 | D8, T2.6, T4.6 |
| 1 a 7 | No incluidas en la captura | Por asignar | Por asignar |

**Nota sobre el nivel 0:** las lecturas (consultar saldos, ver facturas, ver la bitácora) no firman nada. Se implementan como ausencia de capacidad: el lector no tiene llaves y el chat, si existe, no tiene herramientas que muevan fondos. En el informe se declara así, con la prueba de que el componente de lectura no tiene permisos en Roles.
