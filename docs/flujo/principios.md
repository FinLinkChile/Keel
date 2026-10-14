---
type: Principios
title: "Principios que no se rompen"
description: "Los seis principios de diseño y las reglas operativas. Si un componente nuevo rompe alguno, está mal diseñado."
tags: [principios, seguridad, reglas]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

Si un componente nuevo rompe alguno, está mal diseñado. Valen para los dos modos.

1. **La dirección de pago nunca sale de un documento.** En Trade sale de la orden de compra firmada por ambas partes; en Personal, de la tabla de beneficiarios registrados. Un correo o un PDF nunca puede cambiar a quién se paga.
2. **Se firman datos, no papeles.** Toda autorización es una firma EIP-712 sobre datos estructurados, atada a una red y a un contrato. Cambiar un byte invalida la firma. Una firma escaneada en un PDF es una imagen y no prueba nada.
3. **Separación de poderes.** La IA lee, el motor decide, las personas autorizan y el contrato ejecuta. Ninguna pieza hace el trabajo de otra.
4. **Defensa en profundidad.** Cada capa asume que la anterior pudo fallar. Si el motor se compromete, el contrato sigue limitando destino y monto.
5. **Quien frena no puede robar.** El cosignatario y el árbitro pueden detener o decidir entre las partes, pero nunca enviarse fondos.
6. **Todo deja evidencia.** Cada pago, bloqueo y revert queda con su hash en la cadena, y cada decisión es reproducible.

# Reglas operativas

- No hay LLM operativo. El único LLM es el extractor en cuarentena, sin herramientas y con esquema sin texto libre.
- Ninguna llave de servidor es dueña ni módulo directo de una Safe. La llave del dueño nunca vive en un servidor.
- Fallar cerrado siempre avisa: motivo, fecha de vencimiento y alternativa manual.
- Sin sobreafirmaciones: cada afirmación de seguridad dice para quién vale, dónde se hace cumplir y qué prueba la demuestra.
- Lo que se entrega al jurado va en inglés.

Estas reglas vienen de las [decisiones transversales](../decisiones/transversales.md) D2, D3, D8, D9 y D10.
