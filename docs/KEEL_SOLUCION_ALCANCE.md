# Keel: solución, alcance y diseño detallado

**Para qué sirve este documento:** que todo el equipo tenga la misma imagen de qué es Keel, qué construimos para el 2026 Shenzhen FinTechathon, hacia dónde puede crecer y cómo funciona cada parte del flujo. Es la referencia a la que volvemos cuando haya una duda de diseño o de desarrollo.

**Versión:** 13 de octubre de 2026, actualizada el mismo día por el cambio de rumbo. **Estado:** propuesta para revisión del equipo.

**Cambio de rumbo:** Keel dejó de ser un pagador de cuentas. El proyecto es ahora Keel Trade: la aplicación del flujo de escrow a la importación de productos desde China por empresas chilenas, con el corredor Chile y Hong Kong como objetivo, sobre una red cerrada. El objetivo y el flujo están en [flujo_clave.md](flujo_clave.md), que manda si hay diferencias con este documento. Keel Personal queda como la propuesta anterior: ya no se construye.

**Cómo leerlo:**
- Las secciones 1 a 3 son para todos: qué es Keel, el alcance y las ideas de fondo.
- La sección 4 es Keel Personal. Es histórica: se conserva porque de ahí vienen las piezas de la billetera (Safe, Roles, Delay, PDRGate, niveles) que Keel Trade reutiliza.
- La sección 5 es Keel Trade: comercio exterior con escrow. **Es el proyecto**, y su diseño es la referencia para construirlo.
- Las secciones 6 a 9 cubren sistema de pago, seguridad, regulación y preguntas abiertas.

Cada afirmación lleva una etiqueta de estado:

| Etiqueta | Significado |
| --- | --- |
| **[HECHO]** | Existe código con pruebas que pasan |
| **[EN CURSO]** | Está en el plan de esta semana |
| **[DISEÑO]** | Está diseñado aquí, pero todavía no tiene código |
| **[ABIERTO]** | Falta decidir o verificar |

---

## 1. Qué es Keel

### 1.1 En una frase

Keel es una billetera operada por un agente de IA que **solo paga cuando se cumplen condiciones verificables**, con las reglas escritas en contratos que ni la IA ni un atacante pueden cambiar.

Lema: **la IA interpreta una vez, el contrato obedece siempre.**

### 1.2 El problema común

Todo pago automático tiene el mismo punto débil: alguien le dice al sistema a quién pagar, y ese "alguien" puede mentir. Una factura falsa, un correo que avisa de un "cambio de cuenta" o un documento manipulado.

- En lo **personal**, el fraude típico es la factura de luz o de arriendo con la cuenta de destino cambiada.
- En el **comercio exterior**, es el correo del "proveedor" que avisa que cambió su cuenta bancaria justo antes del pago, y además la falta de garantías entre partes que no se conocen: el exportador teme no cobrar y el importador teme pagar y no recibir.

### 1.3 Los dos modos

Keel Trade es el proyecto. Keel Personal fue la propuesta anterior y se muestra para comparar.

| | Keel Personal (anterior) | Keel Trade (el proyecto) |
| --- | --- | --- |
| Para quién | Personas y hogares | Empresas importadoras y exportadoras |
| Qué paga | Cuentas recurrentes: arriendo, luz, internet | Órdenes de compra internacionales: anticipo y saldo |
| Contra qué paga | Facturas autenticadas, a beneficiarios ya registrados | Orden de compra firmada por ambas partes y prueba de embarque firmada por la naviera |
| Pieza central en cadena | PDRGate sobre una Safe con Zodiac Roles y Delay | Contrato de escrow (TradeEscrow) más las mismas piezas de seguridad |
| Quién decide | El motor de política, determinista; la IA solo lee | Las firmas de las partes y de la naviera; el motor verifica documentos |
| Estado en la competencia | Propuesta anterior; no se construye | **Se construye y se demuestra** |

---

## 2. Alcance: qué construimos y a dónde queremos llegar

### 2.1 Alcance de la competencia (entrega el lunes 19 a las 22:00, hora de Chile)

**Dentro:**
1. Keel Trade en una red cerrada: contrato TradeEscrow, firma de la orden de compra por ambas partes, depósito, anticipo, atestación de embarque, saldo y reembolso por vencimiento. **[EN CURSO]**
2. La billetera de la empresa: Safe con Roles y Delay, PDRGate, cosignatario, motor de política y PDR. **[EN CURSO]**
3. Lectura del BL (o la guía aérea) y de la factura con extractor en cuarentena y parser determinista, y comparación contra la orden. **[EN CURSO]**
4. Perfiles de importador y exportador, bitácora y avisos por Telegram. **[EN CURSO]**
5. Los cuatro actos de la demo: orden completa, fraude documental (cambio de cuenta y BL falso), proveedor que no embarca y llave robada. **[EN CURSO]**
6. Batería de red team, evidencia con hashes e informe de seguridad. **[EN CURSO]**

**Fuera (trabajo futuro, se declara así):**
- Keel Personal (pago de cuentas).
- Integración con BL electrónico de navieras, identidad empresarial (WeIdentity o similar), bancos y rampas de entrada y salida de dinero fiat.
- Financiamiento, KYC, KYB y AML/KYT.
- Aduana, impuestos de importación y flete.
- Otros corredores y la exportación desde Chile.

**Por decidir:** qué red cerrada se usa (FISCO BCOS es la candidata natural) y qué token de pago existe en ella. **[ABIERTO]**

### 2.2 Hoja de ruta

| Fase | Qué se agrega | Resultado |
| --- | --- | --- |
| 0. Competencia | Keel Trade en una red cerrada de prueba, con naviera y árbitro representados por llaves de prueba | Flujo de 6 pasos funcionando, verificable con hashes |
| 1. Piloto Chile-Hong Kong | Identidad verificada de empresas, una naviera o agente de carga como firmante del embarque, stablecoin regulada | Un importador real con un proveedor real |
| 2. Integración bancaria | Banco o proveedor de pagos como riel de liquidación y como financista | Pagos sin exigir cripto a las partes |

### 2.3 Lo que no prometemos

- Que la IA "valida firmas" en PDFs. Las firmas válidas son criptográficas; la IA solo lee datos.
- Leer cualquier BL automáticamente: no tienen formato estándar entre navieras.
- Reemplazar la carta de crédito, al agente de aduanas o el pago de impuestos de importación.
- Que un exportador en China continental reciba stablecoins allí: el comercio con criptomonedas está prohibido desde 2021 (sección 8). Por eso el corredor es Chile con Hong Kong.

---

## 3. Ideas que comparten los dos modos

Estas seis ideas son el núcleo de Keel. Si un diseño nuevo rompe alguna, está mal.

1. **La dirección de pago nunca sale de un documento.** En Personal sale de la tabla de beneficiarios registrados; en Trade, de la orden de compra firmada por ambas partes. Un correo o un PDF nunca puede cambiar a quién se paga.
2. **Se firman datos, no papeles.** Toda autorización es una firma EIP-712 sobre datos estructurados, atada a una red y a un contrato. Cambiar un byte invalida la firma.
3. **Separación de poderes.** La IA lee, el motor decide, las personas autorizan y el contrato ejecuta. Ninguna pieza puede hacer el trabajo de otra.
4. **Defensa en profundidad.** Cada capa asume que la anterior pudo fallar. Si el motor se compromete, el contrato sigue limitando destino y monto.
5. **Quien frena no puede robar.** El cosignatario (Personal) y el árbitro (Trade) pueden detener o decidir entre las partes, pero nunca enviar fondos a sí mismos.
6. **Todo deja evidencia.** Cada pago, bloqueo y revert queda con su hash en la cadena, y cada decisión es reproducible.

---

## 4. Keel Personal: pago de cuentas (propuesta anterior, histórica)

**Esta sección ya no describe lo que se construye.** Se conserva como referencia de las piezas de la billetera que Keel Trade reutiliza: actores, PDR, PDRGate, niveles de permiso y el cambio con espera y veto. Las etiquetas de estado de esta sección reflejan el momento en que se escribió.

### 4.1 Actores

| Actor | Qué es | Qué puede hacer |
| --- | --- | --- |
| Dueño | La persona; firma desde su billetera | Configurar beneficiarios, cupos y firmantes, siempre por el Delay |
| Cosignatario | Persona de confianza | Cofirmar montos grandes, vetar cambios, pausar y revocar al agente |
| Motor de Política | Servicio determinista | Decidir el nivel y firmar el PDR |
| Relayer | Llave de servidor | Enviar transacciones y pagar gas; sin autoridad propia |
| Beneficiarios | Arrendador, distribuidora de luz, internet | Recibir pagos; registrados y verificados fuera de banda |

### 4.2 Flujo de un pago

1. **Llega la factura** por correo. Se validan SPF, DKIM y DMARC contra el dominio registrado del beneficiario. *(Ingesta de Facturas)*
2. **Extracción doble:** un parser determinista y un LLM en cuarentena, sin herramientas y con esquema sin texto libre, extraen RUT, folio, periodo y monto. Si no coinciden, nivel 3. *(Ingesta de Facturas)*
3. **Clave de idempotencia:** `invoiceKey = keccak256(abi.encode(RUT, folio, periodo))`. *(Ingesta y Motor)*
4. **Decisión:** el motor evalúa reglas (alias, RUT esperado, monto contra el histórico, cupo, tipo de cambio, texto oculto, mención de cambio de cuenta) y define el nivel. *(Motor de Política)*
5. **Conversión:** pesos a USDC con la tasa menos favorable de dos fuentes más un margen. *(Motor de Política)*
6. **PDR:** se arma `PaymentIntent` con el destinatario tomado **de la tabla de alias**, se calcula el calldata exacto, se arma `PolicyDecision` y se firma con EIP-712. Se simula con `eth_call`. *(Motor de Política)*
7. **Ejecución:** el relayer llama `PDRGate.execute`. El gate verifica los 11 pasos y llama al Roles, que vuelve a revisar destino, función y cupo. La Safe paga. *(Contratos)* **[HECHO: gate y pruebas locales]** **[EN CURSO: Roles real y despliegue]**
8. **Aviso y bitácora:** evento `PaymentExecuted`, mensaje por Telegram con plantilla y línea en la bitácora con enlace a Basescan. *(Producto y Canal Humano)*

### 4.3 Niveles de permiso

| Nivel | Qué cubre | Dónde se hace cumplir |
| --- | --- | --- |
| 0 Leer | Consultas y bitácora | Quien lee no tiene llaves ni permisos |
| 1 Autónomo | Beneficiario conocido, dentro del cupo | Motor, PDRGate y Roles |
| 2 Con espera | Beneficiario nuevo o modificado, cambios de reglas | Delay Modifier: espera y veto |
| 3 Cofirma | Montos grandes o fuera de rango | PDRGate exige la firma del cosignatario |
| 4 Prohibido | Cambiar roles, vaciar, aprobaciones ilimitadas | El rol del agente y del cosignatario no lo permite |

### 4.4 Cambio de beneficiario (el antifraude)

Una factura que menciona una cuenta nueva **nunca paga**: abre una solicitud de cambio. El dueño la revisa en un diff legible, la verifica por otro canal (por ejemplo, una llamada) y la encola en el Delay. El cosignatario puede vetarla durante la espera. Solo un cambio de configuración pendiente a la vez.

---

## 5. Keel Trade: comercio exterior con escrow (el proyecto)

### 5.1 El problema que resuelve

Validado en la entrevista con un importador chileno que compra a China y Alemania:

- Con China casi no se usa carta de crédito. Se paga por transferencia directa, por ejemplo 50% de anticipo y 50% al embarcar.
- Las transferencias internacionales cuestan unos 70 mil pesos cada una y tardan por revisiones manuales.
- Las órdenes de compra se imprimen, se firman, se escanean y se envían por correo; a veces el proveedor ni siquiera las firma.
- La lógica de fondo es universal: **garantía de pago contra garantía de envío.**

Lo que hoy hace un banco en una carta de crédito es garantizarle al exportador que el dinero existe y garantizarle al importador que solo se paga contra documentos. Keel Trade traslada esas dos garantías a un **contrato de escrow** verificable por ambas partes.

### 5.2 Actores

| Actor | Qué es | Qué firma o hace | Qué NO puede hacer |
| --- | --- | --- | --- |
| Importador | Empresa compradora (por ejemplo, desde una Safe de empresa) | Firma la orden de compra, deposita los fondos, puede abrir disputa | Retirar los fondos depositados por su cuenta |
| Exportador | Empresa vendedora | Firma la orden de compra, recibe anticipo y saldo, puede abrir disputa | Cobrar el saldo sin prueba de embarque |
| Naviera o agente de carga | Tercero que transporta la mercancía | Firma la atestación de embarque (BL electrónico) | Mover fondos |
| Árbitro | Tercero acordado por ambas partes en la orden de compra | Resuelve disputas repartiendo fondos **solo entre importador y exportador** | Enviarse fondos a sí mismo |
| Motor de Keel (opcional) | Servicio determinista | Firma un PDR que dice "los documentos cumplen lo pactado" | Liberar fondos por sí solo |
| Representantes | Personas autorizadas por cada empresa | Firman en nombre de la empresa, según sus permisos | Superar los límites que la empresa les dio |

### 5.3 El flujo en seis pasos

```
 1. FIRMA          Importador y exportador firman la orden de compra (EIP-712)
        |
 2. DEPÓSITO       El importador deposita el TOTAL en TradeEscrow
        |            -> el exportador ve en la cadena que el dinero existe y está bloqueado
        |            -> el importador ya no puede retirarlo por su cuenta
        |
 3. ANTICIPO       Se libera el anticipo (por ejemplo 50%) al exportador
        |
 4. EMBARQUE       El exportador embarca; la naviera firma la atestación de embarque
        |
 5. SALDO          El contrato verifica la firma de la naviera y la fecha "on board"
        |            -> se libera el saldo al exportador
        |
 6. VENCIMIENTO    Si no hay atestación válida antes de la fecha límite
                     -> el saldo vuelve al importador
```

Además existen dos caminos laterales: **disputa** (cualquiera de las partes la abre antes del cierre y el árbitro resuelve) y **cancelación de mutuo acuerdo** (ambas firman y los fondos no liberados vuelven al importador).

### 5.4 Máquina de estados del escrow

```
                 open(po, firmas)
  (nada) ─────────────────────────────> ABIERTO
                                           │ fund()  [importador deposita el total]
                                           v
                                       DEPOSITADO ── releaseAdvance() ──> ANTICIPO_PAGADO
                                                                              │
                     ┌───────────────────────────┬────────────────────────────┤
                     │ submitShipment(att, firma)│ refundAfterDeadline()      │ raiseDispute()
                     v   [firma de la naviera,   v   [pasó la fecha límite    v
                 LIQUIDADO  fecha a tiempo]   REEMBOLSADO  sin embarque]   EN_DISPUTA
                 (saldo al exportador)        (saldo al importador)           │ resolve(reparto)
                                                                              v  [firma del árbitro]
                                                                          RESUELTO

  Desde ABIERTO, DEPOSITADO o ANTICIPO_PAGADO: cancel(firmas de ambos) -> CANCELADO
```

Reglas de la máquina:
- Cada transición tiene un único estado de origen permitido. Cualquier otra llamada revierte con `InvalidState`.
- LIQUIDADO, REEMBOLSADO, RESUELTO y CANCELADO son finales: no se puede volver a mover dinero de esa orden.
- La suma de todo lo pagado nunca supera lo depositado. Es la invariante principal y se prueba con fuzz.

### 5.5 Paso 1 en detalle: firma de la orden de compra

**Qué se firma.** Una estructura con los datos que hoy van en la orden de compra en papel:

```solidity
struct PurchaseOrder {
    bytes32 orderId;            // identificador único (por ejemplo hash del número de OC y la fecha)
    address importer;           // billetera o Safe de la empresa importadora
    address exporter;           // billetera o Safe de la empresa exportadora
    address payoutAddress;      // dónde cobra el exportador: FIJADO aquí, firmado por ambos
    address token;              // stablecoin del pago (por ejemplo USDC)
    uint256 totalAmount;        // monto total, en unidades mínimas del token
    uint16  advanceBps;         // anticipo en puntos básicos: 5000 = 50%
    uint64  shipmentDeadline;   // fecha límite de embarque ("on board")
    uint64  disputeWindow;      // segundos que dura la ventana de disputa tras el embarque
    address carrier;            // quién puede firmar la atestación de embarque
    address arbiter;            // árbitro acordado
    bytes32 incoterm;           // EXW, FOB, CIF, CFR...
    bytes32 termsHash;          // hash del documento completo de la OC (con proforma y condiciones)
    bytes32 requiredDocsHash;   // hash de la lista de documentos exigidos
    uint256 nonce;              // evita reutilizar la firma
}
```

**Cómo se firma.** Importador y exportador firman el **mismo digest EIP-712** desde sus billeteras. Si son Safes de empresa, firman con ERC-1271 (la Safe valida que firmaron sus representantes según su umbral).

**Qué verifica el contrato al abrir (`open`):**
1. Que `orderId` no exista ya.
2. Que la firma del importador sea válida para `importer` y la del exportador para `exporter`.
3. Que `advanceBps <= 10000`, `totalAmount > 0` y `shipmentDeadline` esté en el futuro.
4. Que `carrier` y `arbiter` no sean el importador ni el exportador (independencia).
5. Que el token esté en la lista de tokens permitidos.

**La consecuencia antifraude más importante:** `payoutAddress` va dentro de lo firmado por ambos. Un correo que diga "cambiamos de cuenta" no sirve de nada: cambiar la cuenta de cobro exige una **nueva orden firmada por ambas partes**. Es la misma idea de Keel Personal, llevada al fraude más común del comercio exterior.

### 5.6 Paso 2 en detalle: el depósito

**Qué pasa:** el importador transfiere `totalAmount` del token al contrato y el estado pasa a DEPOSITADO.

**Cómo se hace técnicamente:**
- Opción A: `approve(escrow, totalAmount)` y luego `fund(orderId)`, que llama `transferFrom`. La aprobación debe ser **exacta**, nunca ilimitada.
- Opción B (preferible): USDC soporta firmas de permiso (EIP-2612 `permit`), así que aprobación y depósito pueden ir en una sola transacción, sin dejar aprobaciones colgando. **[ABIERTO: confirmar soporte de permit en el USDC de la red elegida]**

**Por qué el exportador puede confiar:** cualquiera puede leer en la cadena que el contrato tiene el saldo y que la orden está en estado DEPOSITADO. El código del escrow no tiene ninguna función que le permita al importador retirar fondos fuera de las transiciones de la máquina de estados.

**Qué verificar en el contrato:** que el saldo recibido sea exactamente `totalAmount` (comparando el saldo antes y después, por si el token cobrara comisiones) y que solo el importador de la orden pueda depositar.

### 5.7 Paso 3 en detalle: el anticipo

**Qué pasa:** se transfieren `totalAmount * advanceBps / 10000` a `payoutAddress`.

**Decisiones de diseño:**
- **Cuándo:** puede liberarse en la misma transacción del depósito o en una llamada aparte. Recomendación: en la misma transacción, porque el anticipo ya estaba pactado y firmado, y así no queda un estado intermedio que alguien pueda aprovechar.
- **Riesgo que se mantiene:** el anticipo sale antes del embarque, igual que hoy. Si el exportador no embarca, el importador pierde el anticipo salvo que lo recupere en una disputa. Es una condición comercial que las partes eligen al fijar `advanceBps` (0% elimina el riesgo).

### 5.8 Paso 4 en detalle: el embarque y la atestación

**Qué firma la naviera.** Una atestación estructurada, firmada con EIP-712:

```solidity
struct ShipmentAttestation {
    bytes32 orderId;        // a qué orden corresponde
    bytes32 blNumberHash;   // hash del número de BL
    uint64  onBoardDate;    // fecha de embarque real ("shipped on board")
    bytes32 portOfLoading;  // puerto de carga
    bytes32 docsHash;       // hash del paquete de documentos (BL, factura, packing list, certificados)
}
```

**Por qué la firma tiene que venir de un tercero.** Si la firmara el exportador, estaría certificando a su favor. La naviera o el agente de carga es quien realmente sabe que la mercancía está a bordo.

**Cómo se obtiene en la práctica:**
1. **Ideal:** desde una plataforma de BL electrónico, donde la naviera emite el documento con firma digital. Ya existen estándares de la industria y leyes que reconocen documentos electrónicos transferibles. **[DISEÑO]**
2. **Intermedio:** un agente de carga registrado firma la atestación tras recibir la carga.
3. **Prototipo:** una llave de prueba que representa a la naviera.

**Qué NO hace la IA aquí.** La IA puede leer el PDF del BL para mostrar los datos al importador o para que el motor compare con la orden, pero **nunca reemplaza la firma de la naviera**. Una firma escaneada en un PDF es una imagen y no prueba nada.

### 5.9 Paso 5 en detalle: verificación y liberación del saldo

`submitShipment(orderId, attestation, carrierSignature)` lo puede llamar cualquiera. El contrato verifica, en este orden:

1. Que la orden esté en ANTICIPO_PAGADO (o DEPOSITADO si el anticipo es 0%).
2. Que `attestation.orderId` coincida.
3. Que la firma sea válida y venga de `po.carrier`.
4. Que `onBoardDate <= shipmentDeadline`.
5. Que el `blNumberHash` **no se haya usado en otra orden** (un mismo BL no puede cobrar dos órdenes).
6. Opcional: que exista un PDR del motor de Keel diciendo que los documentos cumplen lo pactado (montos, mercadería y certificados exigidos).
7. Que no haya una disputa abierta.

Si todo cumple, transfiere el saldo a `payoutAddress` y el estado pasa a LIQUIDADO.

**Ventana de disputa.** Si se configura `disputeWindow`, el saldo no se paga de inmediato: queda marcado como embarcado y se libera al terminar la ventana, salvo que el importador abra una disputa. Es un trade-off: más protección para el importador, cobro más lento para el exportador. Las partes lo eligen en la orden.

### 5.10 Paso 6 en detalle: vencimiento y reembolso

`refundAfterDeadline(orderId)` lo puede llamar **cualquiera** después de `shipmentDeadline` más un margen de gracia. Si no hay atestación válida, el saldo no liberado vuelve al importador y el estado pasa a REEMBOLSADO.

Que lo pueda llamar cualquiera es intencional: el importador no depende de nadie para recuperar su dinero.

**Detalle técnico:** las fechas se comparan con `block.timestamp`, que el productor del bloque puede mover unos segundos. Por eso los plazos se miden en días u horas, nunca en segundos, y el margen de gracia absorbe cualquier ajuste.

### 5.11 Disputas y cancelación

**Disputa:**
- Cualquiera de las partes llama `raiseDispute(orderId)` antes de que la orden esté en un estado final. Los fondos restantes quedan congelados.
- El árbitro firma una resolución: cuánto va al importador y cuánto al exportador. La suma debe ser exactamente el saldo restante.
- **Restricción clave:** el contrato solo permite repartir entre `importer` y `payoutAddress`. El árbitro no puede enviarse nada a sí mismo, igual que el cosignatario de Keel Personal.
- Se puede exigir que la resolución la firmen 2 de 3 (importador, exportador y árbitro), para que el árbitro solo decida cuando las partes no se ponen de acuerdo.

**Cancelación de mutuo acuerdo:** ambas partes firman `CancelOrder(orderId, nonce)` y el saldo no liberado vuelve al importador.

**Lo que el contrato no sabe:** la calidad de la mercadería. Si llega agar en mal estado, eso se resuelve en la disputa, no en el código.

### 5.12 Empresas: representación y permisos

El importador pidió que el dueño tenga la llave principal y delegue a quien opera las compras. En Keel Trade:

- Cada empresa opera desde una **Safe de empresa**, con sus socios como dueños (por ejemplo 2 de 3).
- El encargado de compras recibe un **rol de Zodiac Roles** que le permite firmar órdenes de compra y depositar, con un cupo mensual y solo hacia el contrato TradeEscrow.
- Cambiar quién puede comprar, o los cupos, pasa por el **Delay**, con espera y veto, igual que en Keel Personal.

Así se reutilizan las mismas piezas auditadas del modo personal.

### 5.13 Identidad de las empresas

Una firma de billetera prueba que firmó **una llave**, no **quién** está detrás. Para comercio real hace falta vincular cada billetera con una empresa verificada:

1. **Prototipo:** un registro en cadena de partes verificadas, administrado por Keel (`PartyRegistry`). `open` exige que importador, exportador, naviera y árbitro estén registrados.
2. **Producción:** credenciales verificables (estándar W3C) emitidas por una entidad confiable que digan "esta billetera representa a esta empresa". WeBank tiene su propia solución, **WeIdentity**, que corre sobre FISCO BCOS. Integrarla exigiría un puente o desplegar en FISCO BCOS. **[DISEÑO]**
3. **Validez legal en Chile:** la firma electrónica avanzada (Ley 19.799) da a una firma digital el valor de la firma manuscrita. Vincularla con la billetera es trabajo futuro. **[ABIERTO]**

### 5.14 Interfaz del contrato TradeEscrow (para cuando se desarrolle)

**Funciones:**

| Función | Quién llama | Transición | Notas |
| --- | --- | --- | --- |
| `open(po, sigImporter, sigExporter)` | Cualquiera | nada a ABIERTO | Verifica ambas firmas EIP-712 |
| `fund(orderId)` / `fundWithPermit(...)` | Importador | ABIERTO a DEPOSITADO (y anticipo) | Depósito exacto |
| `releaseAdvance(orderId)` | Cualquiera | DEPOSITADO a ANTICIPO_PAGADO | Solo si no fue en la misma transacción |
| `submitShipment(orderId, att, sigCarrier, pdr?)` | Cualquiera | ANTICIPO_PAGADO a LIQUIDADO | Firma de la naviera y fecha a tiempo |
| `refundAfterDeadline(orderId)` | Cualquiera | ANTICIPO_PAGADO o DEPOSITADO a REEMBOLSADO | Solo pasada la fecha límite |
| `raiseDispute(orderId)` | Importador o exportador | a EN_DISPUTA | Congela los fondos |
| `resolve(orderId, toImporter, toExporter, sigs)` | Cualquiera | EN_DISPUTA a RESUELTO | Firma del árbitro (o 2 de 3) |
| `cancel(orderId, sigImporter, sigExporter)` | Cualquiera | a CANCELADO | Mutuo acuerdo |

**Eventos:** `OrderOpened`, `OrderFunded`, `AdvanceReleased`, `ShipmentAccepted`, `BalanceReleased`, `Refunded`, `DisputeRaised`, `DisputeResolved`, `OrderCancelled`.

**Errores:** `InvalidState`, `OrderExists`, `BadImporterSignature`, `BadExporterSignature`, `BadCarrierSignature`, `ShipmentTooLate`, `BillOfLadingAlreadyUsed`, `DeadlineNotReached`, `NotParty`, `BadResolution`, `TokenNotAllowed`, `AmountMismatch`.

**Invariantes que deben probarse con fuzz:**
1. Lo pagado en total nunca supera lo depositado.
2. Ningún fondo sale hacia una dirección que no sea `importer` o `payoutAddress`.
3. Un estado final nunca vuelve a mover fondos.
4. Un mismo BL nunca liquida dos órdenes.

---

## 6. Sistema de pago

### 6.1 Qué dinero se mueve

| Modo | Token | Red | Por qué |
| --- | --- | --- | --- |
| Trade (competencia) | Stablecoin disponible en la red elegida, o un token de prueba declarado como tal **[ABIERTO]** | Red cerrada por definir; FISCO BCOS es la candidata natural **[ABIERTO]** | Participantes identificados y un entorno que un banco puede operar |
| Trade (piloto) | Stablecoin regulada en la jurisdicción del pago (Hong Kong) | La que soporte esa stablecoin | Las partes necesitan un activo legal en su país |
| Personal (anterior) | USDC | Base Sepolia | Ya no aplica |

### 6.2 Entrada y salida de dinero fiat

- **Personal en Chile (propuesta anterior):** el usuario compra USDC con pesos en un exchange local y lo deposita en su Safe. El beneficiario recibe USDC; si quiere pesos, los convierte en un exchange. El puente directo a pesos es trabajo futuro y se declara así.
- **Trade:** cada parte necesita convertir entre su moneda y la stablecoin. Este es el mayor obstáculo práctico y depende de la regulación de cada país (sección 8).

### 6.3 Tipo de cambio

- Personal (propuesta anterior): dos fuentes (dólar observado del Banco Central y un exchange local). Si difieren más de 1,5% se retiene el pago; se paga con la tasa menos favorable más un margen. El cupo del Roles acota el daño aunque se manipule una fuente.
- Trade: el monto se pacta en la orden directamente en la stablecoin, así que el contrato no necesita tipo de cambio. La conversión ocurre fuera, al entrar y al salir.

### 6.4 Tres modelos de liquidación (para responder "¿y los bancos?")

| Modelo | Cómo funciona | Cuándo sirve |
| --- | --- | --- |
| 1. Todo en la cadena | Escrow y pago en stablecoin | Hoy, entre partes que pueden usar stablecoins |
| 2. Híbrido | Keel decide y deja la evidencia en la cadena; un banco ejecuta el pago tradicional por API | Cuando las partes no pueden o no quieren usar cripto |
| 3. Bancos en la cadena | Depósitos tokenizados o stablecoins emitidas por bancos | A futuro; calza con lo que explora WeBank |

Frase para el jurado: **"Keel no reemplaza al banco; hace que el pago solo ocurra cuando se cumplen condiciones verificables, sea cual sea el riel de pago."**

### 6.5 Financiamiento

Una carta de crédito también financia: el importador paga a 30 o 60 días. Un escrow exige tener el total desde el inicio. La extensión natural es que un **financista** (por ejemplo, un banco) deposite en el escrow a nombre del importador y cobre después. Es una oportunidad de negocio para el banco, no una amenaza. **[DISEÑO]**

---

## 7. Seguridad

### 7.1 Modelo de amenazas de Keel Personal (propuesta anterior)

Las filas de llaves, cosignatario y dueño siguen aplicando a la billetera de Keel Trade. Las de facturas de cuentas ya no.

| Amenaza | Defensa | Dónde se prueba |
| --- | --- | --- |
| Factura con cuenta cambiada | La dirección sale de la tabla de alias; el cambio va al Delay con veto | Red team, acto 2 |
| Prompt injection en la factura | LLM sin herramientas, esquema sin texto libre, concordancia con el parser | Red team |
| Llave del relayer robada | No tiene autoridad sin un PDR válido | `test_relayerKey_cannotCallRolesDirectly` |
| Llave de política robada | El Roles limita destino y cupo | `test_compromisedSigner_*`, fuzz |
| Factura pagada dos veces | `invoicePaid` en la cadena | `test_revert_InvoiceAlreadyPaid_evenWithFreshPDR` |
| Cosignatario malicioso | Su rol solo frena; la revocación solo pone `false` | Prueba negativa pendiente **[EN CURSO]** |
| Dueño salta la espera | Riesgo declarado; ConfigGuard es trabajo futuro | Informe de seguridad |

### 7.2 Modelo de amenazas de Keel Trade

| Amenaza | Ejemplo | Defensa |
| --- | --- | --- |
| Cambio de cuenta por correo | "Nuestra cuenta cambió, paguen aquí" | `payoutAddress` va firmado por ambos; cambiarlo exige una orden nueva |
| BL falso | PDF de BL fabricado | Solo vale la atestación firmada por la naviera registrada |
| Mismo BL para dos órdenes | Cobrar dos veces con un embarque | Registro de `blNumberHash` usados |
| Llave de la naviera robada | Atestaciones falsas | Naviera registrada y rotable; ventana de disputa; monitoreo |
| Colusión de exportador y naviera | Atestación de un embarque que no ocurrió | Ventana de disputa, árbitro, reputación e identidad verificada (riesgo residual declarado) |
| Árbitro corrupto | Reparte a favor de una parte | Solo puede repartir entre las partes; opción de 2 de 3 |
| Importador retira tras ver el embarque | Deja al exportador sin cobrar | El contrato no tiene función de retiro unilateral |
| Exportador nunca embarca | Se queda con el anticipo | Reembolso automático del saldo; el anticipo se recupera solo por disputa |
| Repetición de firmas | Reusar la firma de una orden en otra | EIP-712 con `chainId`, contrato, `orderId` y `nonce` |
| Reentrancia | Token malicioso que reentra | Solo tokens permitidos; checks, effects, interactions; guard de reentrancia |
| Aprobación ilimitada | El importador aprueba de más | `permit` o aprobación exacta |
| Congelamiento del emisor | La stablecoin bloquea una dirección | Riesgo de emisor declarado; los fondos quedan en el escrow |
| Suplantación de empresa | Alguien se hace pasar por el proveedor | Registro de partes verificadas e identidad (sección 5.13) |

### 7.3 Principios que no se negocian en ningún modo

1. Ninguna llave de servidor es dueña ni módulo directo de una Safe.
2. Ninguna dirección de pago sale de un documento sin firma de quien corresponde.
3. Toda afirmación de seguridad nombra dónde se hace cumplir y qué prueba la demuestra (decisión D9).
4. Quien puede frenar no puede cobrar.

---

## 8. Regulación y consideraciones legales

**[ABIERTO: verificar el estado actual antes de citarlo en el deck; el jurado puede saber más que nosotros]**

- **China continental:** el comercio con criptomonedas está prohibido desde 2021. Un exportador en China continental no puede, legalmente, recibir stablecoins y convertirlas libremente a yuanes. Keel Trade con stablecoins no aplica ahí hoy.
- **Hong Kong:** aprobó en 2025 un régimen de licencias para emisores de stablecoins, y WeBank tiene operación ahí. Es el corredor más realista para un piloto Chile-Asia.
- **Chile:** la Ley Fintech (21.521) regula a varios proveedores de servicios financieros, incluidos algunos relacionados con criptoactivos. La firma electrónica avanzada (Ley 19.799) da valor legal a firmas digitales con certificado.
- **Prevención de lavado (AML/KYT):** cualquier versión real exige conocer a las partes (KYC y KYB) y monitorear transacciones. Es trabajo futuro y conviene mencionarlo, porque al jurado de un banco le importa.
- **Aduanas e impuestos:** Keel no paga derechos de aduana ni IVA de importación; eso sigue por los canales actuales.

---

## 9. Preguntas abiertas y decisiones pendientes

| # | Pregunta | Quién decide | Para cuándo |
| --- | --- | --- | --- |
| 1 | ¿Qué red cerrada y qué token de pago se usan? ¿Se pueden desplegar ahí Safe y los módulos de Zodiac? | Equipo y Contratos | Miércoles 14 |
| 2 | ¿El anticipo se libera en la misma transacción del depósito? | Contratos | Antes de prototipar |
| 3 | ¿Se usa ventana de disputa por defecto? ¿De cuántos días? | Equipo | Antes de prototipar |
| 4 | ¿Resolución de disputas por árbitro solo o 2 de 3? | Equipo | Antes de prototipar |
| 5 | ¿El PDR del motor es obligatorio para liberar el saldo o solo informativo? | Motor y Contratos | Antes de prototipar |
| 6 | ¿USDC en la red elegida soporta `permit`? | Contratos | Antes de prototipar |
| 7 | ¿Podemos citar al importador entrevistado, aunque sea de forma anónima? | Quien hizo la entrevista | Antes del deck |
| 8 | ¿Estado actual de la regulación de stablecoins en Hong Kong y de cripto en China? | Red Team y Evidencia | Antes del deck |

---

## 10. Cómo se usa esto en la entrega

| Entregable | Qué va de este documento |
| --- | --- |
| Deck (10 minutos) | Secciones 1 y 3 como problema y principios; Keel Trade como demo, con el flujo de 6 pasos (5.3) y la frase de la sección 6.4 |
| Documento técnico | Sección 5 completa como diseño central; de la sección 4, solo las piezas de billetera que se reutilizan |
| Informe de seguridad | Sección 7.2 completa; de la 7.1, las amenazas de llaves y permisos que siguen aplicando |
| README | Alcance (2.1) y trabajo futuro |
| Respuestas al jurado | Secciones 5.6 (por qué confía el exportador), 6.4 (bancos), 8 (regulación) |

---

## Anexo A: glosario de comercio exterior

| Término | Significado |
| --- | --- |
| Orden de compra (OC) | Documento del importador que acepta una proforma: monto, forma de pago, incoterm, fecha de embarque y documentos exigidos |
| Factura proforma | Cotización formal del exportador antes de la venta |
| BL (Bill of Lading) | Conocimiento de embarque marítimo; título de propiedad de la carga, firmado por la naviera, con la fecha "on board" |
| BL electrónico (eBL) | Versión digital del BL, emitida en una plataforma con firma digital de la naviera |
| Sea Waybill | Documento de transporte que sirve para retirar la carga, pero no es título de propiedad |
| Guía aérea | Equivalente del BL en transporte aéreo |
| Packing list | Lista detallada del contenido de cada bulto |
| Certificado de origen | Acredita el país de origen; sirve para aplicar tratados comerciales |
| Incoterm | Regla que define quién paga y asume riesgo en cada tramo (EXW, FOB, CIF, CFR...) |
| Carta de crédito | Garantía bancaria: el banco paga al exportador contra documentos de embarque |
| Escrow | Depósito en garantía: los fondos quedan bloqueados hasta que se cumplen condiciones |
| Árbitro | Tercero acordado que resuelve disputas entre las partes |

## Anexo B: fuentes internas

- División del trabajo en 5 áreas (decisiones D1 a D10 e interfaces congeladas).
- Resumen de la reunión sobre flujos de pago en comercio exterior (entrevista al importador).
- Biblia del área de Contratos y Permisos en Cadena.
- Código y pruebas de PDRGate (paquete del 13 de octubre).
