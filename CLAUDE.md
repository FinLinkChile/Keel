# Keel

Keel es un agent wallet para comercio exterior: una billetera operada por un agente de IA que paga órdenes de compra internacionales solo cuando se cumplen condiciones verificables, con un contrato de escrow programable (anticipo al firmarse la orden, saldo al probarse el embarque, reembolso si vence el plazo).

Contexto: importación de productos desde China por empresas chilenas, con el corredor Chile y Hong Kong como objetivo, sobre una red cerrada. Keel ya no es un pagador de cuentas (el cambio de rumbo fue el 13 de octubre de 2026). Lo que todavía lo describe así es anterior al cambio y está pendiente de migrar: los README de cada carpeta, las interfaces en `schemas/` y `contracts/src/`, `.env.example` y la sección 4 (Keel Personal, histórica) de `docs/KEEL_SOLUCION_ALCANCE.md`. No tomar esos nombres ni esas interfaces como modelo para componentes nuevos.

## Regla general: alinearse con el flujo clave

`docs/flujo_clave.md` define el objetivo del proyecto y el flujo que se implementa. Es la referencia del equipo. El diseño detallado del escrow está en la sección 5 de `docs/KEEL_SOLUCION_ALCANCE.md`. Si ambos no coinciden, vale `docs/flujo_clave.md`.

Antes de idear, diseñar o crear cualquier componente nuevo (contrato, esquema, módulo, pantalla, mensaje del bot, escenario de red team o documento de diseño):

1. Leer `docs/flujo_clave.md` completo.
2. Responder la lista de la sección 13 ("Cómo usar este documento al idear un componente") y decir en la propuesta a qué paso del flujo sirve el componente.
3. Si la idea contradice el documento, queda fuera del alcance o toca una decisión abierta (sección 14), avisarlo antes de escribir código. No resolver una decisión abierta por cuenta propia.
4. Si el equipo cambia el objetivo o el flujo, actualizar primero `docs/flujo_clave.md` y después el código.

## Principios que no se rompen

1. La dirección de pago nunca sale de un documento. Sale de la orden de compra firmada por ambas partes.
2. Se firman datos, no papeles: toda autorización es una firma EIP-712 sobre datos estructurados.
3. Separación de poderes: la IA lee, el motor decide, las personas autorizan y el contrato ejecuta.
4. Defensa en profundidad: cada capa asume que la anterior pudo fallar.
5. Quien frena no puede robar (cosignatario y árbitro).
6. Todo deja evidencia: cada pago, bloqueo y revert queda con su hash.

## Reglas de trabajo

- No hay LLM operativo. El único LLM es el extractor en cuarentena, sin herramientas y con un esquema de salida sin texto libre.
- Las llaves nunca entran al repositorio. La llave del dueño nunca vive en un servidor.
- Sin sobreafirmaciones: cada afirmación de seguridad dice para quién vale, dónde se hace cumplir y qué prueba la demuestra.
- Lo que se entrega al jurado va en inglés. El trabajo interno puede ir en español.
- Cada área trabaja en su carpeta. Las áreas, ramas y puntos de integración están en `CONTRIBUTING.md`.
