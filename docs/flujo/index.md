# Flujo clave de Keel Trade

* [Checklist antes de idear un componente](checklist-componente.md) - Las ocho preguntas que se responden antes de diseñar o crear algo nuevo, cada una con el concepto que la contesta.
* [Objetivo de Keel](objetivo.md) - Qué es Keel, qué construye el proyecto, los dos modos (Trade y Personal), el corredor y el lema.
* [Principios que no se rompen](principios.md) - Los seis principios de diseño y las reglas operativas. Si un componente nuevo rompe alguno, está mal diseñado.
* [El problema que resuelve Keel](problema.md) - Por qué existe Keel: el punto débil de todo pago automático y los dolores del importador, con la comparación entre carta de crédito y Keel.
* [Actores de Keel Trade](actores.md) - Quién participa en una orden (importador, exportador, naviera, árbitro, agente, representantes, cosignatario), qué firma y qué no puede hacer.
* [El flujo clave en seis pasos](flujo-clave.md) - Vista completa del flujo de Keel Trade: negociación, firma, depósito, anticipo, embarque, saldo y vencimiento. Punto de entrada a cada paso.
* [Paso 0: negociación](paso-0-negociacion.md) - Cotización, factura proforma y armado de la orden de compra, fuera de la cadena. Qué puede hacer el agente antes de la firma.
* [Paso 1: firma de la orden de compra](paso-1-firma-orden.md) - Qué condiciones quedan firmadas por importador y exportador (EIP-712), por qué payoutAddress frena el fraude de cambio de cuenta y qué verifica open.
* [Paso 2: depósito y bloqueo](paso-2-deposito.md) - El importador deposita el total en el escrow: qué queda bloqueado, cómo se aprueba el token y por qué el exportador puede confiar.
* [Paso 3, gatillo 1: anticipo](paso-3-anticipo.md) - Condición y efecto de la liberación del anticipo, y el riesgo que se mantiene si el exportador no embarca.
* [Paso 4: embarque y documentos](paso-4-embarque.md) - La naviera firma la atestación de embarque y el exportador sube BL y factura. Por qué la firma debe venir de un tercero y qué no hace la IA.
* [Paso 5, gatillo 2: saldo](paso-5-saldo.md) - Las siete verificaciones de submitShipment, qué compara el motor para emitir el PDR de documentos y cómo opera la ventana de disputa.
* [Paso 6: vencimiento y reembolso](paso-6-reembolso.md) - Cuándo y cómo vuelve el saldo al importador si no hay prueba de embarque, y por qué cualquiera puede ejecutar el reembolso.
* [Disputa y cancelación](disputa-y-cancelacion.md) - Caminos laterales del flujo: cómo se abre y resuelve una disputa, qué puede repartir el árbitro y cómo se cancela de mutuo acuerdo.
* [Estados del escrow](estados-del-escrow.md) - Máquina de estados de TradeEscrow, reglas de transición y las cuatro invariantes que se prueban con fuzz.
* [Datos firmados e interfaz de TradeEscrow](datos-firmados-e-interfaz.md) - Structs PurchaseOrder y ShipmentAttestation campo por campo, y la tabla de funciones del contrato con quién llama y qué transición produce.
* [Amenazas que el flujo debe resistir](amenazas.md) - Modelo de amenazas de Keel Trade: cada amenaza con su ejemplo, la defensa y el riesgo residual declarado.
* [Alcance: dentro, fuera y lo que no prometemos](alcance.md) - Qué entra en la entrega, qué se declara como trabajo futuro, qué no se promete y la hoja de ruta por fases.
