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
| Decisiones abiertas (1 a 14) | `docs/decisiones/abiertas.md` |
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

Al terminar una tarea, revisar si ocurrió alguno de estos casos. Si ninguno aplica, no tocar `docs/`.

Se actualiza directamente, en el mismo cambio, cuando solo se refleja un hecho que el equipo ya decidió:

| Qué pasó | Qué se actualiza |
| --- | --- |
| El equipo cambió el objetivo o el flujo | `docs/flujo/` primero, después el código |
| El equipo cerró una decisión abierta | El concepto afectado, luego `decisiones/abiertas.md`, después el código |
| El equipo confirmó o descartó algo marcado **[PROPUESTA]** o `status: draft` | Quitar la marca o el `status`, o retirar el contenido descartado |
| Cambió una interfaz compartida en `schemas/` o `contracts/src/` con aprobación del área dueña | El concepto de `docs/interfaces/` o `docs/flujo/datos-firmados-e-interfaz.md` |
| Se completó algo marcado **[EN CURSO]** o **[DISEÑO]** | Cambiar la marca a **[HECHO]** |
| Cambió una tarea, el calendario, un recorte o un entregable por decisión del equipo | El concepto de `docs/trabajo/` o `docs/entrega/` |
| Se agregó, renombró o eliminó un concepto | El `index.md` de la carpeta y los enlaces que apuntaban a él |

Se avisa a la persona antes de editar, porque implica una decisión que no es del agente:

- El código que se va a escribir, o que ya existe, contradice un concepto. No se ajusta la documentación para que coincida con el código sin preguntar.
- Dos conceptos se contradicen. Vale `docs/flujo/`, pero se informa cuál es la diferencia.
- Aparece una amenaza nueva, se debilita una defensa o cambia un riesgo residual (`docs/flujo/amenazas.md`).
- Algo nuevo queda dentro o fuera del alcance (`docs/flujo/alcance.md`).
- Surge una pregunta que nadie ha decidido: se propone agregarla a `decisiones/abiertas.md`, no se responde.
- Un concepto pasó su `stale_after`, o un dato marcado "por verificar" se va a usar como hecho.

No se actualiza la documentación para registrar trabajo hecho, estados de avance ni detalles de implementación que el código ya muestra.

## Cómo actualizar la documentación

Leer primero `docs/README.md` (convenciones). En resumen:

1. Un hecho vive en un solo concepto: editar ese, o crear uno nuevo en la carpeta que corresponda. Si un concepto responde dos preguntas, dividirlo.
2. Frontmatter obligatorio: `type`. Poner siempre `title`, `description` (la pregunta que responde), `tags`, `modo` y `generated: { by: <herramienta>/<modelo>, at: <ISO 8601 UTC> }`. Nunca agregar `verified`: eso lo hace una persona. Si el contenido cambió de fondo, quitar el `verified` que hubiera.
3. Enlaces relativos entre conceptos (`../flujo/actores.md`). No citar números de sección.
4. Actualizar el `index.md` de la carpeta si se agrega, renombra o elimina un concepto o cambia su `description`, y agregar una línea en `docs/log.md` bajo la fecha.
5. Si el equipo cambia el objetivo o el flujo, o cierra una decisión abierta: primero `docs/flujo/` y `docs/decisiones/abiertas.md`, después el código.
6. Lo que se entrega al jurado va en inglés. Sin guiones dobles ni rayas como puntuación.
