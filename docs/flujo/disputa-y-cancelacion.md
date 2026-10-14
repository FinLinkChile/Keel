---
type: Paso del flujo
title: "Disputa y cancelación"
description: "Caminos laterales del flujo: cómo se abre y resuelve una disputa, qué puede repartir el árbitro y cómo se cancela de mutuo acuerdo."
tags: [disputa, arbitro, cancelacion]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

# Disputa

- Cualquiera de las partes llama `raiseDispute(orderId)` antes de que la orden esté en un estado final. Los fondos restantes quedan congelados.
- El árbitro firma una resolución: cuánto va al importador y cuánto al exportador. La suma debe ser exactamente el saldo restante.
- **Restricción clave:** el contrato solo permite repartir entre `importer` y `payoutAddress`. El árbitro no puede enviarse nada a sí mismo, igual que el cosignatario de Keel Personal.
- Se puede exigir que la resolución la firmen 2 de 3 (importador, exportador y árbitro), para que el árbitro solo decida cuando las partes no se ponen de acuerdo.

Si resuelve el árbitro solo o 2 de 3 es la [decisión abierta 5](../decisiones/abiertas.md).

# Cancelación de mutuo acuerdo

Ambas partes firman `CancelOrder(orderId, nonce)` y el saldo no liberado vuelve al importador.

# Lo que el contrato no sabe

La calidad de la mercancía. Si llega agar en mal estado, eso se resuelve en la disputa, no en el código.
