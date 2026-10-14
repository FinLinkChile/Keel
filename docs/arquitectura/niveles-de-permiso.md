---
type: Arquitectura
title: "Niveles de permiso (0 a 4)"
description: "Los cinco niveles, dónde se hace cumplir cada uno y qué nivel tiene cada acción del agente en Keel Trade y en Keel Personal."
tags: [niveles, permisos, agente, cofirma, delay]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

| Nivel | Nombre | Dónde se hace cumplir |
| --- | --- | --- |
| 0 | Leer | Quien lee no tiene llaves ni permisos |
| 1 | Autónomo | Motor, PDRGate y Roles |
| 2 | Con espera | Delay Modifier: espera y veto |
| 3 | Cofirma | PDRGate exige la firma del cosignatario |
| 4 | Prohibido | El rol del agente no lo permite |

# En Keel Trade: qué hace el agente en cada acción **[PROPUESTA]**

| Acción | Quién la origina | Nivel |
| --- | --- | --- |
| Leer proforma, orden, BL y factura, y mostrar un diff legible | Agente | 0 |
| Proponer la orden estructurada a partir de la proforma | Agente propone, representantes firman | 0 |
| Firmar la orden de compra | Representantes de cada empresa | Firma humana |
| Depositar una orden ya firmada, con proveedor conocido y dentro del cupo | Agente | 1 |
| Depositar a un proveedor nuevo | Agente propone | 2 |
| Depositar por sobre el cupo | Agente propone, cosignatario cofirma | 3 |
| Verificar documentos contra la orden y emitir el PDR del gatillo 2 | Agente | 1 |
| Presentar la atestación de embarque al contrato | Agente o cualquiera | 1 |
| Vigilar la fecha límite y ejecutar el reembolso | Agente o cualquiera | 1 |
| Avisar que los documentos no coinciden con la orden y sugerir disputa | Agente avisa, la persona decide | 0 |
| Abrir disputa o cancelar | Personas | Firma humana |
| Cambiar quién puede comprar, cupos o firmante de la política | Dueños, por el Delay | 2 |
| Cambiar `payoutAddress`, naviera o árbitro de una orden firmada | Nadie: exige una orden nueva | 4 |
| Enviar fondos fuera del contrato de escrow | Nadie con el rol del agente | 4 |

Cómo se hace cumplir en la cadena: el rol del agente en el Roles Modifier solo permite llamar al contrato de escrow, con cupo por periodo. El único miembro de ese rol es el gate de Trade, que exige un PDR válido. Cada empresa opera desde su Safe, y cambiar roles o cupos pasa por el Delay.

Firmar la orden de compra, abrir una disputa y cancelar son siempre actos de personas.

El cosignatario puede aprobar o frenar, pero no puede iniciar envíos ni retirar hacia sí mismo. El árbitro de una disputa solo puede repartir entre importador y exportador. Quien frena no puede robar.

La confirmación de estos niveles es la [decisión abierta 9](../decisiones/abiertas.md).

# En Keel Personal

| Nivel | Qué cubre | Dónde se hace cumplir |
| --- | --- | --- |
| 0 Leer | Consultas y bitácora | Quien lee no tiene llaves ni permisos |
| 1 Autónomo | Beneficiario conocido, dentro del cupo | Motor, PDRGate y Roles |
| 2 Con espera | Beneficiario nuevo o modificado, cambios de reglas | Delay Modifier: espera y veto |
| 3 Cofirma | Montos grandes o fuera de rango | PDRGate exige la firma del cosignatario |
| 4 Prohibido | Cambiar roles, vaciar, aprobaciones ilimitadas | El rol del agente y del cosignatario no lo permite |

# Nota sobre el nivel 0

Las lecturas (consultar saldos, ver facturas, órdenes, documentos y bitácora) no firman nada. Se implementan como ausencia de capacidad: el lector no tiene llaves y el chat, si existe, no tiene herramientas que muevan fondos. En el informe se declara así, con la prueba de que el componente de lectura no tiene permisos en Roles.
