# Keel

Keel es un agent wallet para comercio exterior: una billetera operada por un agente de IA que paga órdenes de compra internacionales solo cuando se cumplen condiciones verificables, con un contrato de escrow programable (anticipo al firmarse la orden, saldo al probarse el embarque, reembolso si vence el plazo).

Contexto: importación de productos desde China por empresas chilenas, con el corredor Chile y Hong Kong como objetivo, sobre una red cerrada. El foco pasó del pago de cuentas al comercio exterior el 13 de octubre de 2026. Keel Trade es el modo principal y la demo. Keel Personal (pago de cuentas, `docs/personal/keel-personal.md`) vuelve a estar dentro del alcance como segundo modo; su profundidad en la entrega está por confirmar (decisión abierta 14 de `docs/decisiones/abiertas.md`). Los README de cada carpeta, las interfaces en `schemas/` y `contracts/src/` y `.env.example` son anteriores al cambio: sirven para Keel Personal, pero no son modelo para los componentes de Keel Trade.

## Documentación: usar la skill `keel-docs`

`docs/` es un bundle OKF: conceptos cortos, uno por archivo, con frontmatter y un `index.md` por carpeta. Antes de abrir, buscar o editar cualquier archivo de `docs/`, invocar la skill `keel-docs`: trae el mapa de qué concepto responde cada necesidad y las reglas para actualizar. Leer solo los conceptos que la tarea necesita, nunca la carpeta completa.

La prioridad es que el proyecto avance: la documentación sirve para mantener al equipo al día con las decisiones y nunca detiene una tarea. Al terminar una tarea en la que se tomó una decisión que afecta a otra área (diseño, interfaz, alcance, seguridad o plan), registrarla en el mismo cambio: actualizar el concepto que la cubre y agregar una línea en `docs/log.md` con qué se decidió, quién y por qué. La sección "Cuándo actualizar la documentación" de la skill detalla los casos.

## Regla general: alinearse con el flujo clave

`docs/flujo/` define el objetivo del proyecto y el flujo que se implementa. Es la referencia del equipo: si otro concepto de `docs/` no coincide, vale `docs/flujo/`.

Antes de idear, diseñar o crear cualquier componente nuevo (contrato, esquema, módulo, pantalla, mensaje del bot, escenario de red team o documento de diseño):

1. Invocar la skill `keel-docs` y leer `docs/flujo/checklist-componente.md`.
2. Responder sus ocho preguntas, abriendo solo los conceptos que cada una señala, y decir en la propuesta a qué paso del flujo sirve el componente.
3. Si la idea contradice `docs/flujo/`, queda fuera del alcance (`docs/flujo/alcance.md`) o toca una decisión abierta (`docs/decisiones/abiertas.md`), avisarlo antes de escribir código. No resolver una decisión abierta por cuenta propia.
4. Si el equipo cambia el objetivo o el flujo, actualizar primero `docs/flujo/` y después el código.

Lo mismo vale para una decisión de negocio, de alcance o de seguridad: consultar el concepto que la cubre antes de responder, en lugar de asumir.

## Principios que no se rompen

1. La dirección de pago nunca sale de un documento. Sale de la orden de compra firmada por ambas partes.
2. Se firman datos, no papeles: toda autorización es una firma EIP-712 sobre datos estructurados.
3. Separación de poderes: la IA lee, el motor decide, las personas autorizan y el contrato ejecuta.
4. Defensa en profundidad: cada capa asume que la anterior pudo fallar.
5. Quien frena no puede robar (cosignatario y árbitro).
6. Todo deja evidencia: cada pago, bloqueo y revert queda con su hash.

## Reglas de trabajo

- No hay LLM operativo. El único LLM es el extractor en cuarentena, sin herramientas y con un esquema de salida sin texto libre. **[PROPUESTA, por confirmar por el equipo]:** fuera del flujo de pago, un analista de nivel 0 puede leer métricas calculadas de las órdenes (sin documentos ni nombres) y aconsejar; no firma, no decide ni mueve dinero (`docs/arquitectura/analista.md`).
- Las llaves nunca entran al repositorio. La llave del dueño nunca vive en un servidor.
- Sin sobreafirmaciones: cada afirmación de seguridad dice para quién vale, dónde se hace cumplir y qué prueba la demuestra.
- Lo que se entrega al jurado va en inglés. El trabajo interno puede ir en español.
- Cada área trabaja en su carpeta. Las áreas, ramas y puntos de integración están en `CONTRIBUTING.md`.
