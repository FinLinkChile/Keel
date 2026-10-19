---
type: Plan
title: "Áreas, carpetas y cómo se organizan las tareas"
description: "Qué carpeta y qué área es dueña de cada cosa, cómo se numeran las tareas (base de Personal y agregado por Trade) y las fechas de cierre."
tags: [areas, carpetas, tareas, repositorio]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

# Dónde vive cada cosa

| Carpeta | Área | Qué le corresponde en este flujo |
| --- | --- | --- |
| `contracts/` | 1 | Contrato de escrow, registro de partes, PDRGate, configuración de Safe, Roles y Delay |
| `schemas/` | 2 | Tipos EIP-712 de la orden y de la atestación, esquemas de extracción de BL y factura sin texto libre |
| `engine/` | 2 | Motor determinista: comparación de documentos contra la orden, niveles, PDR y firmas |
| `ingest/` | 3 | Recepción de proforma, orden, BL y factura; parser determinista y extractor en cuarentena |
| `app/` | 4 | Perfiles de importador y exportador, firma de la orden, diff legible, estado del escrow, disputa |
| `bot/` | 4 | Avisos con plantilla: depósito, anticipo, embarque, saldo, vencimiento, bloqueos |
| `redteam/` | 5 | Escenarios: cambio de cuenta, BL falso, BL repetido, inyección en documentos, llave robada |
| `docs/`, `evidence/` | 5 | Documento técnico, informe de seguridad, PDR y hashes |

Los dueños de cada área y las reglas de ramas están en `CONTRIBUTING.md`, en la raíz del repositorio.

# Cómo se numeran las tareas

Cada área tiene su concepto con sus tareas: `Tn.m` es la tarea m del área n, y vive en `area-n-*.md` de esta carpeta.

- **Base (Personal):** las tareas definidas antes del cambio de rumbo. Se mantienen con su número y su contenido original.
- **Agregado por Trade:** lo que el cambio de rumbo suma. Cuando una tarea existe en los dos modos, conserva un solo número y su texto separa qué pide cada modo. Las tareas que solo existen en Trade tienen números nuevos y dicen "agregada por Trade".
- Ninguna tarea queda retirada: T2.3 (tipo de cambio) vuelve a aplicar, solo para Personal.
- Todo lo posterior al lunes 12 es una **propuesta** que confirma el equipo: las interfaces el Área 2, el calendario el Área 5 ([decisión abierta 12](../decisiones/abiertas.md)).

# Cierre

La competencia cierra el martes 20 de octubre a las 23:59 de Beijing, que en Chile es el **martes 20 a las 12:59**. Se planifica entregar el **lunes 19 a las 22:00** (hora de Chile) y dejar el martes como margen. El detalle está en el [calendario](calendario.md).

Regla de trabajo: cada área trabaja en su carpeta y en sus propias ramas. Los cambios a `schemas/` los aprueba el Área 2, y los cambios a contratos ya desplegados, el Área 1.
