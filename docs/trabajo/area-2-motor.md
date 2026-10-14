---
type: Área de trabajo
title: "Área 2: motor de política, PDR, tipo de cambio y claves"
description: "Objetivo, entregables y tareas T2.1 a T2.10: interfaces, reglas del motor, tipo de cambio, firma del PDR, simulación, custodia de llaves, monitor, verificador y plazos."
tags: [area-2, motor, pdr, llaves, t2]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

**Perfil sugerido:** backend en TypeScript con interés en criptografía.
**Objetivo:** convertir una factura validada (Personal), o una orden firmada y unos documentos leídos (Trade), en decisiones deterministas, reproducibles y firmadas, que los contratos puedan verificar. Además, ser dueño de las interfaces y de la custodia de llaves.

# Entregables

* `schemas/` con las interfaces de Personal congeladas el lunes 12 y las de Trade el miércoles 14.
* `engine/` con funciones puras de evaluación, emisión de PDR y firma EIP 712.
* Módulo de tipo de cambio con dos fuentes (Personal).
* Verificador reproducible por línea de comandos.
* Tabla de custodia de llaves y procedimiento de rotación.

# Tareas

**T2.1 Congelar interfaces.**
Escribir los esquemas de [interfaces](../interfaces/index.md) en JSON Schema, zod y Solidity, con pruebas de que las tres versiones calculan el mismo hash para el mismo dato. Si TypeScript y Solidity no coinciden byte a byte, los contratos rechazan todo.
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

# Listo cuando

* Las interfaces están congeladas y probadas en TS y Solidity.
* El motor tiene una prueba unitaria por regla y pasa los corpus del Área 3.
* El verificador reproduce al menos 5 decisiones reales de la red de prueba.
* La tabla de llaves está en el informe de seguridad.

# Dependencias

* Recibe direcciones del Área 1 (jueves 15) y extracciones del Área 3.
* Entrega PDR firmados al Área 1 para pruebas y avisos al Área 4.

# Si falta tiempo

Se recortan el monitor automático (queda solo como aviso humano), una de las dos fuentes de tipo de cambio de Personal (se declara) y la regla de monto en rango de Trade. **Nunca** se recortan la firma EIP 712, el verificador, la idempotencia ni la comparación de documentos contra la orden.
