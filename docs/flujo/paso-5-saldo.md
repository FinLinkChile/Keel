---
type: Paso del flujo
title: "Paso 5, gatillo 2: saldo"
description: "Las siete verificaciones de submitShipment, qué compara el motor para emitir el PDR de documentos y cómo opera la ventana de disputa."
tags: [paso-5, saldo, gatillo-2, submit-shipment, pdr]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

El contrato verifica, en este orden:

1. Que la orden esté en el estado correcto.
2. Que la atestación corresponda a esta orden.
3. Que la firma sea válida y venga de la naviera fijada en la orden.
4. Que la fecha *on board* sea igual o anterior a la fecha límite de embarque.
5. Que ese número de BL no se haya usado en otra orden.
6. Que exista un `DocumentDecision` firmado por el `documentVerifier` de la orden que diga que los documentos cumplen lo pactado, o una `BalanceApproval` firmada por el importador.
7. Que no haya una disputa abierta.

Lo que el motor compara para emitir ese PDR:

| Dato extraído | Contra qué se compara |
| --- | --- |
| Número de BL o de guía aérea | El de la atestación firmada por la naviera |
| Fecha *on board* | La de la atestación y la fecha límite de la orden |
| Monto de la factura | El monto de la orden |
| Partes | Importador y exportador de la orden |
| Mercancía | La descrita en la orden |

El número de orden, el monto y la moneda de la factura y los códigos arancelarios salen de `OrderTerms`, los términos que ambas partes firmaron a través de `termsHash` ([paso 1](paso-1-firma-orden.md)). Si faltan o no son los firmados, el saldo se retiene.

**Efecto:** se transfiere el saldo a `payoutAddress`. Si la orden tiene ventana de disputa, el saldo se libera al terminar la ventana, salvo que el importador abra una disputa.

# Decisión del motor: obligatoria, con dos salidas

Decidido por el Área 2 (Darienn) el 14 de octubre (decisión 3). El saldo se libera solo con un `DocumentDecision` válido o con la aprobación manual del importador. Así, liberar el saldo exige siempre dos firmas independientes: la de la naviera y la del verificador de documentos (o la del propio importador, que es quien paga).

* **Quién firma:** el `documentVerifier` que fija cada orden, firmado por ambas partes. No puede ser el importador, el exportador ni la naviera. Así el comprador no controla por sí solo el pago al vendedor, igual que en una carta de crédito revisa un tercero. En el prototipo es la llave de política del motor de Keel; en producción, quien las partes acuerden. El escrow no tiene un firmante global ni un administrador que lo cambie.
* **Dos pasos:** primero se registra la atestación de la naviera y la orden pasa a Embarcado; después se libera el saldo con el `DocumentDecision` o con la `BalanceApproval`. Los nombres de las funciones los define el Área 1 (ver [datos firmados e interfaz](datos-firmados-e-interfaz.md)).
* **Salida 1, aprobación manual:** si el motor no puede leer el BL o el servicio no responde, el importador firma una `BalanceApproval` sobre esa atestación y el saldo se libera. Es la alternativa manual que exige fallar cerrado.
* **Salida 2, sin reembolso con embarque probado:** una orden en Embarcado ya no se reembolsa por vencimiento. Si el motor retiene y el importador no aprueba, los fondos siguen en el escrow hasta que una de las partes abra una disputa y decida el árbitro. Así un error de lectura nunca le quita el saldo a un exportador que sí embarcó.

El estado de origen es AnticipoPagado, o Depositado si el anticipo es 0%. El struct de esa decisión (`DocumentDecision`) está en [PDR](../interfaces/pdr.md).

# Ventana de disputa

Si se configura `disputeWindow`, el saldo no se paga de inmediato: queda marcado como embarcado y se libera al terminar la ventana, salvo que el importador abra una disputa. Es un trade-off: más protección para el importador, cobro más lento para el exportador. Las partes lo eligen en la orden.

Si se usa por defecto y de cuántos días es la [decisión abierta 4](../decisiones/abiertas.md).
