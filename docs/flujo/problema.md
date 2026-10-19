---
type: Problema
title: "El problema que resuelve Keel"
description: "Por qué existe Keel: el punto débil de todo pago automático y los dolores del importador, con la comparación entre carta de crédito y Keel."
tags: [problema, carta-de-credito, fraude]
modo: ambos
sources:
  - id: entrevista
    resource: ../contexto/entrevista-importador.md
    title: Entrevista con un importador chileno
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

# El punto débil común

Todo pago automático tiene el mismo punto débil: alguien le dice al sistema a quién pagar, y ese "alguien" puede mentir. Una factura falsa, un correo que avisa de un "cambio de cuenta" o un documento manipulado.

- En lo **personal**, el fraude típico es la factura de luz o de arriendo con la cuenta de destino cambiada.
- En el **comercio exterior**, es el correo del "proveedor" que avisa que cambió su cuenta bancaria justo antes del pago, y además la falta de garantías entre partes que no se conocen: el exportador teme no cobrar y el importador teme pagar y no recibir.

# Validado con un importador

De la [entrevista con un importador chileno](../contexto/entrevista-importador.md) que compra a China y Alemania:[^entrevista]

- La lógica de fondo es universal: **garantía de pago contra garantía de envío**. Lo que cambia entre países y productos son los documentos exigidos.
- La carta de crédito da esa garantía, pero es cara y lenta, y con China casi no se usa.
- Lo habitual es la transferencia directa, por ejemplo 50% de anticipo y 50% al embarcar. No hay garantía: el importador confía en la reputación del proveedor.
- Cada transferencia internacional cuesta unos 70 mil pesos y tarda por revisiones manuales.
- Las órdenes de compra se imprimen, se firman, se escanean y se envían por correo. A veces el proveedor ni siquiera las firma.
- El fraude típico es el correo del "proveedor" que avisa que cambió su cuenta bancaria justo antes del pago.

# Carta de crédito frente a Keel

Lo que hoy hace un banco en una carta de crédito es garantizarle al exportador que el dinero existe y garantizarle al importador que solo se paga contra documentos. Keel Trade traslada esas dos garantías a un **contrato de escrow** verificable por ambas partes.

| En la carta de crédito | En Keel |
| --- | --- |
| Los bancos guardan la plata | El contrato de escrow guarda la plata |
| El banco le garantiza al exportador que el dinero existe | El exportador lo ve en la cadena: depositado y bloqueado |
| El banco revisa los documentos de embarque | La naviera firma la prueba de embarque y el motor verifica que los documentos cumplen lo pactado |
| El banco libera el pago | El contrato libera el anticipo y luego el saldo |
| Si no se cumple, el banco no paga | Si vence el plazo, el saldo vuelve al importador |

[^entrevista]: Entrevista con un importador chileno
