---
type: Actores
title: "Actores de Keel Trade"
description: "Quién participa en una orden (importador, exportador, naviera, árbitro, agente, representantes, cosignatario), qué firma y qué no puede hacer."
tags: [actores, permisos]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

| Actor | Qué es | Qué firma o hace | Qué no puede hacer |
| --- | --- | --- | --- |
| Importador | Empresa compradora, desde su Safe | Firma la orden de compra, deposita, puede abrir disputa | Retirar por su cuenta los fondos depositados |
| Exportador | Empresa vendedora | Firma la orden de compra, recibe anticipo y saldo, puede abrir disputa | Cobrar el saldo sin prueba de embarque |
| Naviera o agente de carga | Tercero que transporta la mercancía | Firma la atestación de embarque | Mover fondos |
| Árbitro | Tercero acordado en la orden de compra | Resuelve disputas repartiendo solo entre importador y exportador | Enviarse fondos |
| Agente de Keel | Extractor, motor, PDR y relayer | Lee documentos, prepara acciones, firma el PDR, vigila plazos | Liberar fondos por sí solo, cambiar destinos o reglas |
| Representantes | Personas autorizadas por cada empresa | Firman en nombre de la empresa según sus permisos | Superar los límites que la empresa les dio |
| Cosignatario | Persona de confianza de la empresa | Cofirma montos grandes, veta cambios, pausa al agente | Iniciar envíos o retirar hacia sí mismo |

Los actores de Keel Personal están en [Keel Personal](../personal/keel-personal.md). Qué puede hacer el agente en cada acción está en [niveles de permiso](../arquitectura/niveles-de-permiso.md).
