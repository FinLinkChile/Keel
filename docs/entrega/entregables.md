---
type: Entrega
title: "Entregables y pendientes con la organización"
description: "Lista de entregables con su tarea e issue, qué exigen las bases y qué tarea cubre cada elemento, qué concepto alimenta cada uno y las preguntas pendientes a la organización del concurso."
tags: [entregables, deck, informe, organizacion]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-16T12:00:00Z }
---

Todo lo que se entrega al jurado va en inglés (D10).

| Entregable | Tarea | Issue |
| --- | --- | --- |
| Coordinación, inscripción y entrega | T5.1 | #34 |
| Verificación de afirmaciones | T5.2 | #35 |
| Informe de autoevaluación de seguridad | T5.3 | #36 |
| `EXECUTION_EVIDENCE.md` | T5.5 | #38 |
| Documento técnico y README | T5.6 | #39 |
| Deck y video | T5.7 | #40 |
| Repositorio abierto al jurado y licencias | T5.8 | #63 |
| Rama de entrega e instrucciones reproducibles | T5.9 | #64 |

# Qué exigen las bases y qué tarea lo cubre

Las bases del International Track (Appendix 2) piden seis elementos, todos en inglés, con cierre el martes 20 de octubre a las 12:59 hora de Chile, el mismo plazo para la inscripción. Elegimos el Topic F (Agent Wallet).

| # | Lo que piden las bases | Tareas que lo cubren |
| --- | --- | --- |
| 01 | Documento técnico: arquitectura del sistema, descripción del algoritmo central y diseño de seguridad | T5.6 |
| 02 | Deck de la presentación final, 10 minutos como máximo | T5.7, T5.2 |
| 03 | Video de demo, opcional, 5 minutos como máximo | T5.7, T4.8 |
| 04 | Código fuente con README, enlace al repositorio de GitHub, instrucciones de despliegue y casos de prueba | T5.8, T5.9, T5.6, T1.8 |
| 05 | Informe de autoevaluación de seguridad: implementación de los niveles de permiso y lista de riesgos conocidos | T5.3, T5.4 |
| 06 | Evidencia de ejecución: para el tema en cadena, hashes de transacciones reales | T1.0 (token), T1.1 a T1.4, T1.8, T5.5 |

Además, fuera del repositorio: inscripción del equipo, de 2 a 5 estudiantes de tiempo completo en universidades fuera de China continental, Hong Kong, Macao y Taiwán, con al menos 60% de integrantes no chinos (T5.1).

Puntaje: cumplimiento de la tarea 40%, seguridad y cumplimiento 30%, innovación e interacción 30%, más un bono de 0 a 5 puntos por exploración en cadena.

# Qué concepto alimenta cada entregable

| Entregable | De dónde sale |
| --- | --- |
| Deck (10 minutos) | [Objetivo](../flujo/objetivo.md) y [principios](../flujo/principios.md) como problema e idea central; Keel Trade como demo, con el [flujo de seis pasos](../flujo/flujo-clave.md) y la frase de los tres modelos de liquidación en [sistema de pago](../pagos/sistema-de-pago.md) |
| Documento técnico | La carpeta [flujo](../flujo/index.md) como diseño central; [Keel Personal](../personal/keel-personal.md) como segundo modo y como origen de las piezas de billetera |
| Informe de seguridad | [Amenazas](../flujo/amenazas.md) completo; [amenazas de Keel Personal](../personal/amenazas.md) para ese modo y para las llaves y permisos comunes |
| README | [Alcance](../flujo/alcance.md) y trabajo futuro |
| Respuestas al jurado | Por qué confía el exportador ([paso 2](../flujo/paso-2-deposito.md)), bancos ([sistema de pago](../pagos/sistema-de-pago.md)), [regulación](../pagos/regulacion.md) y [respaldo para el jurado](../contexto/respaldo-jurado.md) |

# Pendientes con la organización

Correo a la organización (wangyr@pbcsf.tsinghua.edu.cn):

1. ¿Las transacciones en una red cerrada o de prueba cuentan como "real on-chain transaction hashes"? El jurado necesita poder verificarlas, así que hay que definir cómo accede a la red o al explorador.
2. Conflicto de fechas: las bases indican cierre el 20 de octubre, pero la página de IEEE CIS Shenzhen publica una cronología tentativa con cierre preliminar el 2 de noviembre. Planificar para el 20 y confirmar; no contar con la holgura.
3. Composición del equipo: 2 a 5 integrantes, al menos 60% no chinos.
