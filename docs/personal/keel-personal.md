---
type: Modo
title: "Keel Personal: pago de cuentas (segundo modo)"
description: "Diseño del segundo modo: actores, flujo de un pago de cuenta recurrente, niveles de permiso y cambio de beneficiario con espera y veto."
tags: [personal, pago-de-cuentas, beneficiarios]
modo: personal
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

Keel Personal está dentro del alcance como segundo modo. Además es la referencia de las piezas de la billetera que Keel Trade reutiliza: actores, PDR, PDRGate, niveles de permiso y el cambio con espera y veto. Las etiquetas de estado de esta sección reflejan el momento en que se escribió (antes del cambio de rumbo); la red y el token se deciden junto con los de Keel Trade.

# Actores

| Actor | Qué es | Qué puede hacer |
| --- | --- | --- |
| Dueño | La persona; firma desde su billetera | Configurar beneficiarios, cupos y firmantes, siempre por el Delay |
| Cosignatario | Persona de confianza | Cofirmar montos grandes, vetar cambios, pausar y revocar al agente |
| Motor de Política | Servicio determinista | Decidir el nivel y firmar el PDR |
| Relayer | Llave de servidor | Enviar transacciones y pagar gas; sin autoridad propia |
| Beneficiarios | Arrendador, distribuidora de luz, internet | Recibir pagos; registrados y verificados fuera de banda |

# Flujo de un pago

1. **Llega la factura** por correo. Se validan SPF, DKIM y DMARC contra el dominio registrado del beneficiario. *(Ingesta de Facturas)*
2. **Extracción doble:** un parser determinista y un LLM en cuarentena, sin herramientas y con esquema sin texto libre, extraen RUT, folio, periodo y monto. Si no coinciden, nivel 3. *(Ingesta de Facturas)*
3. **Clave de idempotencia:** `invoiceKey = keccak256(abi.encode(RUT, folio, periodo))`. *(Ingesta y Motor)*
4. **Decisión:** el motor evalúa reglas (alias, RUT esperado, monto contra el histórico, cupo, tipo de cambio, texto oculto, mención de cambio de cuenta) y define el nivel. *(Motor de Política)*
5. **Conversión:** pesos a USDC con la tasa menos favorable de dos fuentes más un margen. *(Motor de Política)*
6. **PDR:** se arma `PaymentIntent` con el destinatario tomado **de la tabla de alias**, se calcula el calldata exacto, se arma `PolicyDecision` y se firma con EIP-712. Se simula con `eth_call`. *(Motor de Política)*
7. **Ejecución:** el relayer llama `PDRGate.execute`. El gate verifica los 11 pasos y llama al Roles, que vuelve a revisar destino, función y cupo. La Safe paga. *(Contratos)* **[HECHO: gate y pruebas locales]** **[EN CURSO: Roles real y despliegue]**
8. **Aviso y bitácora:** evento `PaymentExecuted`, mensaje por Telegram con plantilla y línea en la bitácora con enlace a Basescan. *(Producto y Canal Humano)*

# Niveles de permiso

Los niveles 0 a 4 y lo que cubre cada uno en este modo están en [niveles de permiso](../arquitectura/niveles-de-permiso.md).

# Cambio de beneficiario (el antifraude)

Una factura que menciona una cuenta nueva **nunca paga**: abre una solicitud de cambio. El dueño la revisa en un diff legible, la verifica por otro canal (por ejemplo, una llamada) y la encola en el Delay. El cosignatario puede vetarla durante la espera. Solo un cambio de configuración pendiente a la vez.

Los esquemas de este modo (`InvoiceExtraction`, `PaymentIntent`) están en [interfaces](../interfaces/index.md). Sus amenazas están en [amenazas de Keel Personal](amenazas.md).
