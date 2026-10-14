---
type: Guía
title: "Checklist antes de idear un componente"
description: "Las ocho preguntas que se responden antes de diseñar o crear algo nuevo, cada una con el concepto que la contesta."
tags: [checklist, diseno, componente-nuevo]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

Antes de diseñar o crear algo nuevo (contrato, esquema, módulo, pantalla, mensaje del bot, escenario de red team o documento), responder estas preguntas. Leer solo los conceptos que la pregunta necesite.

| # | Pregunta | Dónde se responde |
| --- | --- | --- |
| 1 | **¿A qué paso del flujo sirve?** Si no sirve a ninguno ni a la base de agent wallet, probablemente está fuera del objetivo | [Flujo clave](flujo-clave.md) y el paso que corresponda; [piezas de la billetera](../arquitectura/piezas-de-la-billetera.md); para el segundo modo, [Keel Personal](../personal/keel-personal.md) |
| 2 | **¿Rompe algún principio?** En especial: ¿algún dato de un documento termina decidiendo a quién o cuánto se paga? | [Principios](principios.md) |
| 3 | **¿Quién tiene autoridad sobre esa acción y en qué nivel?** Si el agente gana un poder nuevo, ¿dónde se hace cumplir en la cadena? | [Niveles de permiso](../arquitectura/niveles-de-permiso.md) y [actores](actores.md) |
| 4 | **¿Respeta los estados y las invariantes?** | [Estados del escrow](estados-del-escrow.md) |
| 5 | **¿Abre una amenaza nueva o debilita una defensa?** | [Amenazas](amenazas.md) |
| 6 | **¿A qué carpeta y área pertenece?** Un cambio en `schemas/` se avisa a todas las áreas | [Áreas y carpetas](../trabajo/areas-y-carpetas.md) y [reglas de cambio de interfaces](../interfaces/reglas-de-cambio.md) |
| 7 | **¿Está dentro del alcance?** Si está fuera, se anota como trabajo futuro en lugar de construirse | [Alcance](alcance.md) |
| 8 | **¿Toca una decisión abierta?** Si es así, se decide con el equipo antes de escribir código | [Decisiones abiertas](../decisiones/abiertas.md) |

La propuesta del componente dice a qué paso del flujo sirve. Si la idea contradice un concepto de `flujo/`, queda fuera del alcance o toca una decisión abierta, se avisa antes de escribir código.
