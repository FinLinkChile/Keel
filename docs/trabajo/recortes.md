---
type: Plan
title: "Reglas de recorte"
description: "Qué se recorta y en qué orden si falta tiempo, qué nunca cae y qué queda como trabajo futuro declarado."
tags: [recortes, prioridades, trabajo-futuro]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

Si el viernes 16 el acto 1 no funciona de punta a punta, el Área 5 activa el recorte en este orden:

1. Disputa con vista del árbitro (queda por script, o como diseño).
2. Liberación diferida por ventana de disputa.
3. Registro de partes en cadena (queda una lista fija).
4. ConfigGuard (se declara el riesgo).
5. Monitor automático (queda el aviso humano).
6. Guía aérea y canal de correo de Trade (quedan el BL marítimo y la carga desde la app).
7. Alta de proveedor con transferencia de prueba (queda una lista precargada).
8. Segunda fuente de tipo de cambio de Personal (se declara).
9. Resumen diario de solicitudes de Personal.

**Nunca caen:** PDRGate, rol AGENTE, Delay para cambios, cosignatario con veto, extracción sin texto libre, TradeEscrow con sus cuatro invariantes, firma de la orden por ambas partes, atestación de embarque firmada, reembolso por vencimiento, cuatro actos de la demo, script de evidencia, informe de seguridad.

**Abierto:** dónde entra Keel Personal en este orden si falta tiempo. Depende de la [decisión abierta 14](../decisiones/abiertas.md).

Cada área tiene además su propio orden de recorte en la sección "Si falta tiempo" de su concepto.

# Lo que queda fuera del prototipo y por qué

- **Integración con BL electrónico de navieras:** trabajo futuro. En el prototipo, la naviera es una llave de prueba registrada.
- **Identidad empresarial con credenciales verificables (WeIdentity o similar):** trabajo futuro. En el prototipo, un registro de partes administrado por Keel.
- **Bancos y rampas fiat:** trabajo futuro. Se responde con los tres modelos de liquidación de [sistema de pago](../pagos/sistema-de-pago.md).
- **Financiamiento:** lámina de trabajo futuro. Un tercero deposita a nombre del importador y cobra después.
- **Aduana, impuestos y flete:** Keel no los toca.
- **Compilador de mandato en lenguaje natural y efecto red de atestaciones (EAS):** fuera, igual que antes.
