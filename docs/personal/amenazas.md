---
type: Amenazas
title: "Amenazas de Keel Personal y de llaves comunes"
description: "Modelo de amenazas del pago de cuentas. Las filas de llaves, cosignatario y dueño aplican también a la billetera de Keel Trade."
tags: [amenazas, personal, llaves]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

Las filas de llaves, cosignatario y dueño aplican también a la billetera de Keel Trade. Las de facturas de cuentas aplican solo a Keel Personal.

| Amenaza | Defensa | Dónde se prueba |
| --- | --- | --- |
| Factura con cuenta cambiada | La dirección sale de la tabla de alias; el cambio va al Delay con veto | Red team, acto 2 |
| Prompt injection en la factura | LLM sin herramientas, esquema sin texto libre, concordancia con el parser | Red team |
| Llave del relayer robada | No tiene autoridad sin un PDR válido | `test_relayerKey_cannotCallRolesDirectly` |
| Llave de política robada | El Roles limita destino y cupo | `test_compromisedSigner_*`, fuzz |
| Factura pagada dos veces | `invoicePaid` en la cadena | `test_revert_InvoiceAlreadyPaid_evenWithFreshPDR` |
| Cosignatario malicioso | Su rol solo frena; la revocación solo pone `false` | Prueba negativa pendiente **[EN CURSO]** |
| Dueño salta la espera | Riesgo declarado; ConfigGuard es trabajo futuro | Informe de seguridad |
