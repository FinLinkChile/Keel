# Skill: Conventional Commit Generator

## Objetivo
Analizar los cambios de código, diffs o resúmenes de avance proporcionados por el usuario y generar un título sugerido y un mensaje de commit que cumpla estrictamente con la especificación Conventional Commits 1.0.0-beta.4.

## Reglas de Ejecución (Estricto)
1. *NO EJECUTAR COMANDOS DE GIT SIN AUTORIZACIÓN:* NO ejecutes la acción de commit automáticamente (git commit), ni invoques herramientas de terminal para aplicar los cambios, sin la autorización del usuario.
2. *ENTREGA EN CHAT:* Muestra siempre el resultado dentro de bloques de texto en el chat para que el usuario pueda revisarlo, copiarlo o editarlo libremente o directamente indicarte que hagas la accion de commit y push.
3. *NO TRAIL DE CLAUDE*: No agregues el trail de colaboración de Claude en el contenido del commit.

## Estructura de Conventional Commits
Formato requerido:
<type>[scope opcional]: <descripción>

[cuerpo opcional]

[pie de página opcional]

### Tipos Permitidos:
- *feat:* Nueva característica (incrementa MINOR en SemVer).
- *fix:* Corrección de un error (incrementa PATCH en SemVer).
- *docs:* Cambios solo en documentación.
- *style:* Formato, espacios, comas (sin cambios en la lógica del código).
- *refactor:* Reestructuración de código que no arregla un bug ni añade una función.
- *perf:* Cambio de código que mejora el rendimiento.
- *test:* Añadir o corregir tests existentes.
- *chore:* Tareas de mantenimiento, dependencias o configuración de build.
- *improvement:* Mejora una implementación existente sin añadir función ni arreglar bug.

### Cambios Rompientes (BREAKING CHANGE):
- Añadir ! después del tipo/alcance (ej: feat(api)!: cambio en respuesta).
- O incluir BREAKING CHANGE: <descripción> al inicio del cuerpo o pie de página (incrementa MAJOR en SemVer).

---

## Formato de Salida Obligatorio

Responde siempre utilizando la siguiente estructura fija:

*Título del Avance*
> <Un título claro y conciso del avance realizado, ideal para PR o resumen>


*Mensaje de Commit*
```text
<type>(<scope>): <descripción corta en minúsculas y sin punto final>

<cuerpo opcional explicando el QUÉ y el POR QUÉ del cambio>

<pie opcional, ej: BREAKING CHANGE: ... o Closes #123>