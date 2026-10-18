---
type: Alcance
title: "MVP y seguridad por país"
description: "Qué es Keel hoy (un MVP), qué medidas de seguridad se prometen a futuro (CloudFront con WAF, autenticación de personas con terceros legales de cada país) y cómo se amplía el sistema según la legislación y las obligaciones de cada país."
tags: [mvp, seguridad, trabajo-futuro, cloudfront, waf, identidad, legislacion, promesas]
modo: ambos
status: draft
generated: { by: claude-code/claude-sonnet-5-5, at: 2026-10-18T17:00:00Z }
---

**[PROPUESTA]** del Área 2 (Darienn), 18 de octubre de 2026. Falta que el equipo la confirme. Es la lista de promesas de seguridad a futuro para mostrar en la presentación: ninguna está construida hoy y ninguna se afirma como cumplida. Se suma a lo que [alcance](alcance.md) ya declara como trabajo futuro.

# Qué es Keel hoy: un MVP

Keel es un producto mínimo viable. Demuestra el flujo de seis pasos y sus garantías en una red de prueba pública (Base Sepolia), con llaves de prueba para la naviera y el árbitro. No es un sistema listo para operar bajo la regulación de un país.

* Para quién vale cada garantía, dónde se hace cumplir y qué prueba la demuestra está en el [informe de seguridad](../entrega/seguridad-y-red-team.md) y en las [amenazas](amenazas.md), con los riesgos declarados.
* La verificación de identidad de la app es simulada (`app/src/data/onboarding.ts`): hoy una firma prueba que firmó **una llave**, no quién está detrás ([identidad de las empresas](../arquitectura/identidad-de-empresas.md)).
* El **objetivo** es ampliar el sistema de seguridad a medida que Keel entra a cada país, según su legislación y sus obligaciones. El cumplimiento no se promete hoy: se construye país por país.

# Promesas de seguridad a futuro

| Promesa | Qué agrega | Qué cierra | Cuándo | Estado hoy |
| --- | --- | --- | --- | --- |
| CloudFront con WAF delante de la API | La API pasa a una REST API con AWS WAF (regla de tasa por IP, límite de tamaño del cuerpo y reglas administradas) y CloudFront como entrada pública | Hoy cada petición de un atacante cuesta una invocación y el throttling de la HTTP API es por ruta y no por IP | Antes de usar Keel con usuarios reales | HTTP API con throttling por ruta ([despliegue en AWS](../arquitectura/despliegue-aws.md)) |
| Autenticación de personas con terceros legales de cada país | Cada persona que opera (representantes del importador y del exportador, cosignatario, árbitro) se autentica con un proveedor de identidad o de firma electrónica reconocido legalmente en su país, vinculado a su billetera | Hoy no se sabe quién está detrás de una llave, y el registro de la app no verifica a nadie | En el piloto de cada corredor | Simulado en la app **[ABIERTO: qué proveedor por país]** |
| Identidad verificada de las empresas (KYB) | Credenciales verificables que digan "esta billetera representa a esta empresa" | Los proveedores y terceros de confianza los aprueba la propia empresa, sin verificar que existan | Piloto Chile-Hong Kong | Registros de la Safe en el gate ([identidad](../arquitectura/identidad-de-empresas.md)) |
| Validez legal de la firma | Vincular la firma electrónica avanzada con la billetera (en Chile, Ley 19.799) | La firma de billetera no tiene hoy el valor legal de una firma manuscrita | Piloto en Chile | **[ABIERTO]** |
| KYC, KYB y monitoreo AML/KYT | Conocer a las partes y vigilar transacciones según cada país | Prevención de lavado: lo exige cualquier versión real | Piloto de cada corredor | Fuera de la entrega ([alcance](alcance.md)) |
| Protección de datos personales por país | Plazos de conservación, derechos de las personas, aviso de privacidad y responsable, según la ley de cada país (en Chile, Ley 21.719) | Quedan abiertos hoy | Antes de tratar datos de personas reales | Parcial ([datos personales](../arquitectura/datos-personales.md)) |

Las dos primeras filas son las que esta propuesta agrega. Las demás ya estaban declaradas en otros conceptos y se reúnen aquí para tener una sola lista.

# Cómo se amplía por país

Cada país nuevo se agrega con el mismo método:

1. **Levantar sus obligaciones**: identidad, firma electrónica, prevención de lavado, protección de datos y reglas sobre criptoactivos y pagos.
2. **Elegir proveedores terceros reconocidos legalmente** en ese país para autenticar a las personas y a las empresas. Keel no emite identidad: se apoya en quien la ley reconoce.
3. **Agregar el control en la capa donde se hace cumplir** (la app, la API, la ingesta o el contrato) y no solo en una.
4. **Declarar lo que cubre**: para quién vale, dónde se hace cumplir y qué prueba lo demuestra. Sin sobreafirmaciones.

Lo que cada país agrega son capas. Los [principios que no se rompen](principios.md) no cambian: la dirección de pago sale de la orden firmada, se firman datos y no papeles, la IA lee y el motor decide, y la llave del dueño nunca vive en un servidor.

| País | Obligaciones conocidas | Qué agregaría Keel |
| --- | --- | --- |
| Chile | Ley 21.521 (Fintech), Ley 19.799 (firma electrónica avanzada) y Ley 21.719 (datos personales) | Vincular la firma electrónica avanzada con la billetera, cumplir la ley de datos y evaluar si Keel cae bajo la Ley Fintech **[ABIERTO]** |
| Hong Kong | Régimen de licencias de emisores de stablecoins aprobado en 2025 y AML/KYT | Stablecoin regulada para el pago, identidad verificada de las empresas y monitoreo de transacciones **[ABIERTO]** |
| China continental | El comercio con criptomonedas está prohibido desde 2021 | Queda fuera mientras tanto: el corredor es Chile con Hong Kong **[ABIERTO]** |
| Otros países | Las que corresponda a cada expansión | El método de arriba |

Todo el estado regulatorio está **por verificar antes de citarlo** ([regulación](../pagos/regulacion.md), decisión abierta 10): el jurado puede saber más que nosotros.

# Para la presentación

**[PROPUESTA]** Frase: "Keel es un MVP. Su seguridad crece con cada país, según su ley y sus obligaciones."

For the deck (English):

* Keel is an MVP: it proves the flow and its guarantees on a public test network, not a system ready for regulated production.
* The goal is to extend the security model country by country, following each country's legislation and obligations.
* Planned hardening: CloudFront with a web application firewall (AWS WAF) in front of the API.
* Planned identity: people authenticate with third-party providers that are legally recognized in their country, linked to their wallet.

# Qué sigue abierto

* Qué proveedor de autenticación se usa en cada país: hoy no hay ninguno elegido. Si el equipo lo decide, pasa a [decisiones abiertas](../decisiones/abiertas.md).
* El estado actual de la regulación de cada país (decisión abierta 10).
* Cuándo entra cada promesa: la columna "Cuándo" sigue el orden de las fases de [alcance](alcance.md), pero las fechas no están fijadas.
