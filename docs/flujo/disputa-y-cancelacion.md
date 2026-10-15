---
type: Paso del flujo
title: "Disputa y cancelación"
description: "Caminos laterales del flujo: cuándo se abre una disputa, qué puede repartir el árbitro, cómo se cancela de mutuo acuerdo y por qué la firma de cancelación queda atada al estado."
tags: [disputa, arbitro, cancelacion, cancel-nonce]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T21:00:00Z }
---

# Disputa

- El importador o el exportador llama `raiseDispute(orderId)` cuando la orden está en Embarcado, y solo ahí. Los fondos restantes quedan congelados. Desde AnticipoPagado revierte (`InvalidState`): sin embarque no hay nada que disputar, y una disputa ahí le permitiría al exportador congelar un reembolso ya debido. Cambio pedido por el Área 2 (Darienn) en la revisión del PR #49. Costo aceptado: si el importador ve que el exportador no va a embarcar, ya no puede pedir al árbitro una salida temprana; espera el reembolso tras el plazo o pide al exportador una cancelación firmada.
- **En Embarcado no hay límite de tiempo.** Es la salida que garantiza que el saldo nunca quede atrapado si el verificador de documentos no firma y el importador no aprueba ([paso 5](paso-5-saldo.md)). La ventana de disputa es el plazo mínimo antes de que el verificador pueda liberar el saldo, no el plazo para disputar: cualquier parte puede abrir una disputa mientras el saldo no haya salido. El costo es que una parte puede usarla para demorar el pago; el árbitro lo resuelve.
- El árbitro firma una resolución: cuánto va al importador y cuánto al exportador. La suma debe ser exactamente el saldo restante (el total menos el anticipo ya pagado). El contrato arma `DisputeResolution` con los montos de la llamada, así que una firma sobre otro reparto no sirve.
- **Restricción clave:** el contrato solo permite repartir entre `importer` y `payoutAddress`. El árbitro no puede enviarse nada a sí mismo, igual que el cosignatario de Keel Personal. Además, el árbitro no puede ser una parte, `payoutAddress` ni el verificador de documentos.
- Resuelve el árbitro solo. Decidido por el Área 1 (Adrean) el 14 de octubre ([decisión 5](../decisiones/abiertas.md)); la variante 2 de 3 queda como trabajo futuro.

**Riesgo declarado:** una orden en disputa solo se mueve con la firma del árbitro o con la cancelación de ambas partes. No hay plazo automático: si el árbitro no responde y las partes no se ponen de acuerdo, el saldo queda en el escrow.

# Cancelación de mutuo acuerdo

- Ambas partes firman `CancelOrder(orderId, nonce)` y el saldo no liberado vuelve al importador. Se puede cancelar desde Abierto (no hay fondos que devolver), AnticipoPagado y EnDisputa. Desde EnDisputa (al que solo se llega desde Embarcado) es la forma de salir de una disputa sin el árbitro.
- **El nonce es `cancelNonceOf(orderId)`**, que el escrow calcula como `(stateVersion << 8) | estado`. La app y el motor lo leen del contrato justo antes de pedir las firmas, no lo calculan. Como cada transición cambia ese valor, una firma de cancelación solo vale en la versión y el estado exactos en que se firmó: una cancelación firmada antes del depósito no sirve después, y una firmada para un estado no sirve en otro.

# Lo que el contrato no sabe

La calidad de la mercancía. Si llega agar en mal estado, eso se resuelve en la disputa, no en el código.
