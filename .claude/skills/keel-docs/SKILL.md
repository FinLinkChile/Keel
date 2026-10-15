---
name: keel-docs
description: Cómo encontrar, leer y actualizar la documentación de Keel (bundle OKF en docs/). Usar SIEMPRE antes de abrir, buscar o editar cualquier archivo de docs/, y antes de idear, diseñar o crear un componente (contrato, esquema, módulo, pantalla, mensaje del bot, escenario de red team) o de tomar una decisión de negocio, de alcance o de seguridad del proyecto.
---

# Documentación de Keel

`docs/` es un bundle OKF: archivos markdown cortos, un concepto por archivo, cada uno con frontmatter (`type`, `title`, `description`, `tags`, `modo`, `status`). El objetivo es leer solo lo que la tarea necesita.

## Cómo leer gastando poco

1. Ubicar el concepto con el mapa de abajo. Si no está, leer `docs/index.md` (rutas por necesidad y carpetas) y, si hace falta, el `index.md` de la carpeta: una línea por concepto.
2. Abrir solo ese concepto. Seguir un enlace solo si la respuesta depende de él.
3. Para buscar por tema sin abrir archivos: Grep sobre `docs/` con `^(title|description|tags):` y la palabra clave.
4. No leer carpetas completas ni `docs/log.md` (es historial). No releer un concepto ya leído en la conversación.

## Mapa

| Necesito | Concepto |
| --- | --- |
| Crear o diseñar algo nuevo | `docs/flujo/checklist-componente.md` (empezar aquí) |
| Vista del flujo y a qué paso sirve algo | `docs/flujo/flujo-clave.md`, luego `docs/flujo/paso-N-*.md` |
| Disputa, cancelación | `docs/flujo/disputa-y-cancelacion.md` |
| Estados, transiciones, invariantes | `docs/flujo/estados-del-escrow.md` |
| Structs firmados y funciones de TradeEscrow | `docs/flujo/datos-firmados-e-interfaz.md` |
| Esquemas de extracción, intenciones, PDR, eventos y errores | `docs/interfaces/` |
| Quién puede hacer qué, niveles 0 a 4 | `docs/arquitectura/niveles-de-permiso.md`, `docs/flujo/actores.md` |
| Safe, Roles, Delay, PDRGate, qué es el agente | `docs/arquitectura/piezas-de-la-billetera.md` |
| Extractor en cuarentena y parser | `docs/arquitectura/pipeline-de-documentos.md` |
| Amenazas y riesgo residual | `docs/flujo/amenazas.md`, `docs/personal/amenazas.md` |
| Alcance, trabajo futuro, lo que no se promete | `docs/flujo/alcance.md` |
| Decisiones ya tomadas (D1 a D14) | `docs/decisiones/transversales.md` |
| Decisiones abiertas (1 a 16) | `docs/decisiones/abiertas.md` |
| Keel Personal (pago de cuentas) | `docs/personal/keel-personal.md` |
| Token, red, fiat, bancos, regulación | `docs/pagos/` |
| Tareas `Tn.m`, entregables y recortes de un área | `docs/trabajo/area-n-*.md` |
| Carpetas, dueños, calendario, recortes | `docs/trabajo/areas-y-carpetas.md`, `calendario.md`, `recortes.md` |
| Negocio: importador, mercado, WeBank, glosario | `docs/contexto/` |
| Demo, informe de seguridad, entregables | `docs/entrega/` |

Los principios que no se rompen y las reglas de trabajo ya están en `CLAUDE.md`: no hace falta abrir `docs/flujo/principios.md` salvo para citar el detalle.

## Identificadores

Se resuelven sin buscar: `D1` a `D14` en `decisiones/transversales.md`; decisión abierta `N` en `decisiones/abiertas.md`; tarea `Tn.m` en `trabajo/area-n-*.md`; paso `N` en `flujo/paso-N-*.md`; crítica `N` en `trabajo/mapa-de-criticas.md`. Una cita antigua del tipo "sección N de flujo_clave.md" se traduce con la tabla de equivalencias de `docs/log.md`.

## Cómo interpretar lo leído

- **Precedencia:** `docs/flujo/` es la referencia del equipo. Si otro concepto lo contradice, vale `flujo/` y se avisa de la diferencia.
- **Marcas:** `status: draft` y **[PROPUESTA]** son diseños sin confirmar; **[ABIERTO]** falta decidirlo. No tratarlos como hechos ni cerrarlos por cuenta propia.
- **Confianza:** un concepto sin `verified` no ha sido revisado por una persona del equipo. Si de él depende una decisión importante, decirlo.
- **Modo:** `modo: trade | personal | ambos`. Las interfaces y README anteriores al 13 de octubre sirven para Keel Personal, no como modelo para Keel Trade.

## Antes de crear un componente

Leer `docs/flujo/checklist-componente.md` y responder sus ocho preguntas abriendo solo los conceptos que cada una necesite. En la propuesta, decir a qué paso del flujo sirve. Si la idea contradice `flujo/`, queda fuera del alcance o toca una decisión abierta, avisarlo antes de escribir código.

## Cuándo actualizar la documentación

La prioridad es que el proyecto avance. La documentación existe para que el equipo se entere de las decisiones, no para frenar el trabajo. Dos reglas:

1. **La documentación nunca detiene una tarea.** Si algo no calza o falta, se sigue trabajando y se deja anotado.
2. **Toda decisión que afecte a otra área queda registrada en el mismo cambio**, para que el resto del equipo la vea sin tener que preguntar.

Qué se registra al terminar una tarea:

| Qué pasó | Qué se hace |
| --- | --- |
| Se tomó una decisión de diseño, interfaz, alcance, seguridad o plan | Actualizar el concepto que la cubre para que diga lo que rige ahora |
| Se cerró una decisión abierta | Actualizar el concepto afectado y dejar la respuesta en `decisiones/abiertas.md` |
| El código quedó distinto de lo documentado | Actualizar el concepto. La documentación sigue al proyecto, no al revés |
| Cambió una interfaz compartida en `schemas/` o `contracts/src/` | Actualizar `docs/interfaces/` o `docs/flujo/datos-firmados-e-interfaz.md` |
| Se confirmó, descartó o completó algo marcado **[PROPUESTA]**, **[EN CURSO]** o **[DISEÑO]** | Cambiar la marca o retirar lo descartado |
| Cambió una tarea, el calendario, un recorte o un entregable | Actualizar `docs/trabajo/` o `docs/entrega/` |
| Surgió una pregunta que nadie ha decidido | Agregarla a `decisiones/abiertas.md`, seguir con el supuesto más razonable y anotarlo ahí |
| Apareció una amenaza o un riesgo nuevo | Agregarlo a `docs/flujo/amenazas.md` |

En todos los casos se agrega una línea en `docs/log.md` con qué se decidió, quién lo decidió y por qué. Esa línea es la que mantiene al equipo al día.

Cómo registrar sin frenar:

- Si la decisión la tomó una sola persona y afecta a otras áreas, se registra igual y se marca **[PROPUESTA]** hasta que el equipo la confirme. El trabajo sigue.
- Si lo decidido contradice `docs/flujo/`, se actualiza `flujo/` en el mismo cambio y se dice en el resumen final de la tarea. No se deja la documentación desactualizada.
- Lo único que sí se consulta antes de avanzar es romper uno de los principios de `CLAUDE.md`.

No se registran avances, estados de tareas ni detalles de implementación que el código ya muestra: eso es ruido para quien busca decisiones.

## Cómo actualizar la documentación

Leer primero `docs/README.md` (convenciones). En resumen:

1. Un hecho vive en un solo concepto: editar ese, o crear uno nuevo en la carpeta que corresponda. Si un concepto responde dos preguntas, dividirlo.
2. Frontmatter obligatorio: `type`. Poner siempre `title`, `description` (la pregunta que responde), `tags`, `modo` y `generated: { by: <herramienta>/<modelo>, at: <ISO 8601 UTC> }`. Nunca agregar `verified`: eso lo hace una persona. Si el contenido cambió de fondo, quitar el `verified` que hubiera.
3. Enlaces relativos entre conceptos (`../flujo/actores.md`). No citar números de sección.
4. Actualizar el `index.md` de la carpeta si se agrega, renombra o elimina un concepto o cambia su `description`, y agregar una línea en `docs/log.md` bajo la fecha.
5. Si el equipo cambia el objetivo o el flujo, o cierra una decisión abierta: primero `docs/flujo/` y `docs/decisiones/abiertas.md`, después el código.
6. Lo que se entrega al jurado va en inglés. Sin guiones dobles ni rayas como puntuación.
