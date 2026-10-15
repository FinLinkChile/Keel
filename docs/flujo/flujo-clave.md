---
type: Flujo
title: "El flujo clave en seis pasos"
description: "Vista completa del flujo de Keel Trade: negociación, firma, depósito, anticipo, embarque, saldo y vencimiento. Punto de entrada a cada paso."
tags: [flujo, escrow, gatillos]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T01:40:00Z }
---

```
 0. NEGOCIACIÓN    Cotización, factura proforma y acuerdo (fuera de la cadena)
        |
 1. FIRMA          Importador y exportador firman la orden de compra (EIP-712)
        |            -> quedan fijadas las condiciones: destino, montos, plazos, naviera, árbitro
        |
 2. DEPÓSITO       El importador deposita el TOTAL en el contrato de escrow
        |            -> el exportador ve en la cadena que el dinero existe y está bloqueado
        |            -> el importador ya no puede retirarlo por su cuenta
        |
 3. GATILLO 1      Orden firmada por ambos y fondos depositados
        |            -> se libera el ANTICIPO al exportador
        |
 4. EMBARQUE       El exportador embarca; la naviera firma la atestación de embarque
        |            -> el exportador sube el BL (o la guía aérea) y la factura
        |
 5. GATILLO 2      Firma de la naviera válida, fecha "on board" a tiempo, documentos conformes
        |            -> se libera el SALDO al exportador
        |
 6. VENCIMIENTO    Si no hay prueba de embarque válida antes de la fecha límite
                     -> el saldo vuelve al importador
```

Caminos laterales: **disputa** (cualquiera de las partes la abre antes del cierre y el árbitro resuelve) y **cancelación de mutuo acuerdo** (ambas firman y los fondos no liberados vuelven al importador).

# Detalle de cada paso

| Paso | Concepto | Función del contrato |
| --- | --- | --- |
| 0 | [Negociación](paso-0-negociacion.md) | Fuera de la cadena |
| 1 | [Firma de la orden de compra](paso-1-firma-orden.md) | `open` |
| 2 | [Depósito y bloqueo](paso-2-deposito.md) | `fund` |
| 3 | [Gatillo 1: anticipo](paso-3-anticipo.md) | `fund` (misma transacción del depósito) |
| 4 | [Embarque y documentos](paso-4-embarque.md) | Atestación de la naviera |
| 5 | [Gatillo 2: saldo](paso-5-saldo.md) | `submitShipment`, luego `releaseBalance` o `approveBalance` |
| 6 | [Vencimiento y reembolso](paso-6-reembolso.md) | `refundAfterDeadline` |
| Lateral | [Disputa y cancelación](disputa-y-cancelacion.md) | `raiseDispute`, `resolve`, `cancel` |

Las transiciones permitidas están en [estados del escrow](estados-del-escrow.md) y los datos que se firman en [datos firmados e interfaz](datos-firmados-e-interfaz.md).
