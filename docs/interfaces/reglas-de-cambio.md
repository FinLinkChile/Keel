---
type: Regla
title: "Reglas de cambio de las interfaces compartidas"
description: "Quién es dueño de las interfaces, dónde viven, cuándo se congelan y qué exige cambiarlas después."
tags: [interfaces, congelamiento, schemas]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

Propuesta: las interfaces de Trade se congelan el miércoles 14 de octubre a las 20:00 (hora de Chile).

El Área 2 es dueña de estas definiciones. Viven en `schemas/`, como JSON Schema y tipos TypeScript (zod), y como structs en Solidity. Cambiarlas después del congelamiento exige avisar a las 5 áreas.

Las interfaces de Personal (`InvoiceExtraction`, `PaymentIntent`) se congelaron el lunes 12 y se mantienen. Las de Trade se agregan y se congelan el miércoles 14. `PolicyDecision` es común a los dos modos.
