# Interfaces compartidas

* [Avisos al bot de Telegram](avisos-al-bot.md) - Cómo le entregan el motor, la ingesta y otros productores los avisos al bot: dos rutas HTTP, sus tokens, cuerpos y respuestas, y cómo se traduce la salida de ingesta a avisos.
* [Eventos y errores tipados](eventos-y-errores.md) - Nombres fijos de los eventos y errores de PDRGate, del gate de Trade (FundingGate) y de TradeEscrow, por modo.
* [Esquemas de extracción de documentos](extraccion-de-documentos.md) - Salida del extractor en cuarentena, sin texto libre: factura de cuenta recurrente (Personal), documento de transporte y factura comercial (Trade).
* [Intenciones: PaymentIntent y FundIntent](intenciones.md) - Structs de la intención de pago (Personal) y de la intención de depósito (Trade) que firma el motor dentro del PDR.
* [PDR: Registro de Decisión de Política](pdr.md) - Qué es un PDR, en qué dos momentos se emite, los structs PolicyDecision y DocumentDecision y el dominio EIP-712.
* [Reglas de cambio de las interfaces compartidas](reglas-de-cambio.md) - Quién es dueño de las interfaces, dónde viven, cuándo se congelan y qué exige cambiarlas después.
