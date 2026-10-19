---
type: Plan
title: "Calendario y puntos de integración"
description: "Hitos día a día del 12 al 20 de octubre (hora de Chile) y los cuatro puntos de integración entre áreas."
tags: [calendario, integracion, hitos]
modo: ambos
status: draft
stale_after: 2026-10-20T15:59:00Z
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

Este calendario es el que se replanificó para Trade. Las tareas de base de Personal todavía no tienen fechas propias desde el martes 13: el Área 5 las ubica cuando el equipo cierre la [decisión abierta 14](../decisiones/abiertas.md).

| Día | Hito | Áreas clave |
|---|---|---|
| Lun 12 | Inicio. Interfaces del pago de cuentas congeladas. Repositorio con estructura. | 2, 5 |
| Mar 13 | **Cambio de rumbo.** Objetivo y flujo publicados en el flujo clave. Borrador de las interfaces nuevas. Keel Personal vuelve al alcance. Tablero actualizado. | Todas |
| Mié 14 | **Interfaces nuevas congeladas a las 20:00. Red y token decididos.** TradeEscrow en pruebas locales. Motor con las primeras reglas. Parser y extractor sobre 3 conjuntos de documentos. | 1, 2, 3 |
| Jue 15 | **Despliegue v1 y primer revert real.** Firma EIP 712 compatible entre TS y Solidity. Rol AGENTE y PDRGate. Perfiles y firma de la orden en la app. | 1, 2, 4 |
| Vie 16 | **Integración de punta a punta: acto 1 en la red de prueba.** Corpus completo entregado. Primera corrida de red team. | Todas |
| Sáb 17 | Actos 2, 3 y 4 funcionando. Delay, cosignatario y botón de pánico. Disputa. Borradores de documentos. | Todas |
| Dom 18 | **Congelamiento de funciones a las 20:00.** Despliegue final. Script de evidencia. Ensayo general. | Todas |
| Lun 19 | Documentos, deck y video finales. **Entrega a las 22:00.** | 5 con apoyo de todos |
| Mar 20 | Margen. Cierre oficial a las 12:59. | 5 |

# Puntos de integración

1. **Miércoles 14, 20:00:** congelamiento de las interfaces nuevas y decisión de red y token (Área 2 y Área 1 con todas).
2. **Jueves 15:** direcciones y ABIs publicados (Área 1 hacia 2, 4 y 5).
3. **Viernes 16:** una orden real de punta a punta: firma, depósito por el gate, anticipo, atestación, lectura de documentos, PDR y saldo, visible en la bitácora.
4. **Domingo 18:** despliegue final. Después de esto no se cambian contratos, solo documentos.

El punto de integración de Personal (un pago real de punta a punta: correo, extracción, motor, PDR, gate, Roles y token, visible en la bitácora) no tiene fecha todavía. Depende de la [decisión abierta 14](../decisiones/abiertas.md).
