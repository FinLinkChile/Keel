---
type: Área de trabajo
title: "Área 5: red team, evidencia, documentación y coordinación"
description: "Objetivo, entregables y tareas T5.1 a T5.9: coordinación, verificación de afirmaciones, informe de seguridad, batería de red team, script de evidencia, documento técnico, deck y video, repositorio abierto al jurado y rama de entrega."
tags: [area-5, red-team, evidencia, entrega, t5]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T22:00:00Z }
---

**Perfil sugerido:** quien coordine, escriba bien en inglés y piense como atacante.
**Objetivo:** que todo lo que construyen las otras áreas se convierta en puntaje: evidencia con hash, métricas, un informe de seguridad honesto y una presentación clara. También es dueño del calendario y de la entrega.

# Entregables

* Batería de red team ejecutable con su reporte.
* Script de evidencia en cadena con `EXECUTION_EVIDENCE.md`.
* Informe de autoevaluación de seguridad con niveles de permiso y lista de riesgos conocidos.
* Documento técnico, README, deck de 10 minutos y video de 5 minutos, en inglés.
* Formulario de inscripción y entrega final.

# Tareas

**T5.1 Coordinación.**
* Inscribir al equipo y confirmar que se cumple el requisito de al menos 60% de integrantes no chinos.
* Enviar el correo a la organización (wangyr@pbcsf.tsinghua.edu.cn) con dos preguntas: si las transacciones en una red cerrada o de prueba cuentan como transacciones reales y cómo debe poder verificarlas el jurado, y si el cierre es el 20 de octubre o el 2 de noviembre.
* Reunión diaria de 15 minutos a la misma hora.
* Actualizar el tablero con las tareas de este documento: las de base y las agregadas por Trade.
* Puntos de integración del [calendario](calendario.md).
* Cerrar con el equipo la [decisión abierta 14](../decisiones/abiertas.md): con qué profundidad entra Personal en la entrega.

**T5.2 Verificación de afirmaciones (crítica 16 y D9).**
Revisar cada cifra y afirmación antes de que entre al deck, y marcar con fuente o eliminar:
* incidente DRB y sus cifras;
* "imposible para cualquiera" y "ninguno conocido".

**Personal (base):**
* Neat Pagos;
* crecimiento de Cobre;
* "ningún competidor ataca el fraude de facturas". Reformular: el repositorio Leash ya trata facturas con cambio de datos.

**Trade (agregado):**
* costo y demora de las transferencias internacionales (hoy la única fuente es la entrevista);
* "con China casi no se usa carta de crédito" (ídem);
* regulación de cripto en China continental y de stablecoins en Hong Kong;
* qué plataformas de comercio exterior sobre blockchain y de BL electrónico existen, antes de decir que algo no existe.

Confirmar además si se puede citar al importador entrevistado.

**T5.3 Informe de autoevaluación de seguridad.**
* Tabla de niveles: nivel, qué cubre, dónde se hace cumplir (escrow, gate, Roles, motor o interfaz), prueba que lo demuestra y hash de evidencia. La construye con el Área 1.
* El nivel 4 se redacta con precisión: prohibido para el agente y el cosignatario; el dueño puede cambiar reglas solo vía Delay, con aviso y veto, y si no está el ConfigGuard, se declara que puede saltárselo.
* Lista de riesgos conocidos, sin "ninguno conocido".
  * Comunes: configuración de Roles no auditada por terceros; firmante de política en un servidor; riesgo de emisor del token de pago; Telegram como canal; la bitácora prueba lo registrado, no que nada se haya escapado.
  * **Personal (base):** fuentes del tipo de cambio; puente fiat centralizado.
  * **Trade (agregado):** contrato de escrow propio, sin auditoría de terceros; naviera y árbitro representados por llaves de prueba; proveedores y terceros de confianza aprobados por la propia empresa en su gate, sin verificación de identidad en la cadena; colusión de exportador y naviera; el anticipo no se recupera en la cadena (la disputa solo reparte el saldo restante y no se abre antes del embarque), solo por acuerdo entre las partes fuera de la cadena; verificación pública limitada en una red cerrada.
* Tabla de llaves de T2.7.

**T5.4 Batería de red team (40 escenarios mínimo).**

Comunes y de Personal (base):

| Categoría | Ejemplos |
|---|---|
| Factura | cuenta cambiada; texto oculto; homoglifos; monto alterado; folio repetido con otro píxel |
| Correo | remitente falso sin DKIM; inundación de solicitudes; reenvío con adjunto cambiado |
| Interfaz | inyección en un campo dirigida a Telegram; diff con direcciones parecidas |
| Tipo de cambio | fuente manipulada; divergencia entre fuentes |
| Llaves | relayer robado; firmante de política robado; uso del rol fuera del sistema |
| Contrato | todos los casos de T1.7 ejecutados en la red de prueba |
| Onboarding | alta con dirección falsa; verificación con monto equivocado |

Agregados por Trade:

| Categoría | Ejemplos |
|---|---|
| Cuenta de cobro | correo de cambio de cuenta; factura con otra cuenta; orden nueva con una dirección parecida |
| Documentos | BL fabricado; firma escaneada pegada; fecha *on board* alterada; monto alterado; texto oculto; homoglifos |
| Embarque | atestación firmada por otra llave; atestación de otra orden; mismo BL en dos órdenes; embarque tardío |
| Escrow | retiro del importador; anticipo doble; reembolso anticipado; llamadas sobre estados finales; árbitro que intenta cobrar |

Métricas:
* tasa de bloqueo de ataques;
* falsos positivos sobre los documentos legítimos;
* porcentaje de facturas pagadas sin intervención humana (Personal) y de órdenes completadas sin intervención más allá de las firmas (Trade);
* latencia de decisión;
* **capa que detuvo cada ataque**: canal, extractor, motor, gate, Roles, escrow o humano.

La última métrica es la que mejor muestra la defensa en profundidad.

**T5.5 Script de evidencia en cadena.**
Un comando que, sobre el despliegue final, genera y documenta con su hash.

Personal (base):
1. Pago de nivel 1 exitoso.
2. Alta de beneficiario en cola y ejecutada tras el enfriamiento.
3. Cambio de beneficiario vetado por el cosignatario.
4. Pago de nivel 3 con cofirma.
5. Revert por destinatario fuera de la lista (Roles).
6. Revert por falta de PDR válido (gate).
7. Revert por calldata distinto del aprobado.
8. Revert por factura ya pagada.
9. Revert por `delegatecall`.
10. Revocación del rol por el botón de pánico.
11. Intento de pago posterior que revierte.

Agregado por Trade:
1. Orden abierta con ambas firmas.
2. Depósito de nivel 1 por el gate.
3. Anticipo liberado.
4. Embarque aceptado y saldo liberado.
5. Reembolso por vencimiento en otra orden.
6. Depósito de nivel 3 con cofirma.
7. Revert por atestación no firmada por la naviera.
8. Revert por fecha *on board* tardía.
9. Revert por BL ya usado.
10. Revert por intento de retiro o de llamada fuera de estado.
11. Revert del Roles por destino no permitido (el robo directo).
12. Revert por falta de PDR válido (gate).
13. Revocación del rol por el botón de pánico y depósito posterior que revierte.
14. Disputa resuelta por el árbitro (si T4.10 y la disputa no se recortan).

**T5.6 Documento técnico y README.**
* Documento técnico: arquitectura con diagrama, algoritmo central (motor más PDR más gate, y en Trade además el escrow), diseño de seguridad y comparación honesta con el estado del arte (Leash, Coinbase, Cobo, Safe con Roles, PACE).
* README: qué es, cómo desplegar, cómo correr las pruebas y la batería de red team, y enlaces a la evidencia.
* Mantener `docs/flujo/` y [decisiones abiertas](../decisiones/abiertas.md) al día cuando el equipo cierre una decisión abierta.

**T5.7 Deck y video.**
* Deck de 10 minutos con este orden: incidente DRB, problema, idea central, arquitectura, cuatro actos, métricas, seguridad, alineación con WeBank, límites honestos.
* Video de 5 minutos con los cuatro actos grabados desde la app del Área 4, con narración en inglés.
* Los cuatro actos de Personal (base): pago normal, factura fraudulenta, cambio legítimo de beneficiario y llave robada. Los cuatro de Trade (agregado): orden completa, fraude documental (cambio de cuenta y BL falso), proveedor que no embarca y llave robada. Trade es la demo principal; **abierto:** qué actos de Personal entran en el deck y en el video.
* Ensayo general el domingo 18.

**T5.8 Repositorio abierto al jurado y licencias (agregada por las bases de entrega).** **[PROPUESTA]**
Las bases piden el enlace al repositorio de GitHub, y `FinLinkChile/Keel` es privado.
* Decidir con el equipo cómo accede el jurado: repositorio público (lo más simple) o acceso invitado, si la organización lo acepta. Hacerlo público es irreversible en la práctica (puede quedar copiado o indexado): lo decide el equipo, no una sola persona.
* Antes de abrirlo, revisar el historial completo: que no haya llaves, `.env`, tokens del bot ni del LLM, ni datos reales del importador entrevistado (T5.2 confirma si se puede citar).
* Agregar `LICENSE` y un aviso de terceros con sus licencias (Safe y Zodiac en LGPL-3.0, OpenZeppelin en MIT, forge-std y las dependencias de npm). Las bases exigen que el código de terceros esté bien licenciado.

**T5.9 Rama de entrega e instrucciones reproducibles (agregada por las bases de entrega).** **[PROPUESTA]**
Hoy `main` solo tiene el andamiaje; el trabajo está en `dev` y en PRs abiertas. El jurado verá la rama por defecto.
* Revisar y mergear las PRs abiertas a `dev` antes del congelamiento del domingo 18 a las 20:00, y después `dev` a `main`.
* Que `npm install`, `npm test` y `forge test` pasen desde un clon limpio en Linux, macOS y Windows. Hoy fallan 3 pruebas de `ingest/` en Windows (permisos de archivo en `settings.test.ts` y dos timeouts); se coordina con el Área 3.
* Alinear con la red decidida (Base Sepolia, [decisión abierta 1](../decisiones/abiertas.md)) lo que todavía dice que no está elegida: `contracts/README.md` y los README de cada carpeta.
* Instrucciones de despliegue en inglés que cualquiera pueda seguir: requisitos, variables de `.env.example`, comando de despliegue de T1.8 y dónde quedan las direcciones (`contracts/deployments/84532.json`).

# Listo cuando

* El script de evidencia corre de punta a punta sobre el despliegue final.
* La batería de red team y sus métricas están en el repositorio.
* Los seis elementos de la entrega están subidos el lunes 19 a las 22:00.
* El jurado puede abrir el repositorio, y `main` tiene el código final con pruebas que pasan e instrucciones de despliegue.

# Dependencias

Depende de todas las áreas. Por eso es dueño del calendario y puede pedir recortes.

# Si falta tiempo

Se recortan la comparación extensa con el estado del arte (queda una tabla) y la narración profesional del video. **Nunca** se recortan el informe de seguridad, la evidencia en cadena ni la entrega a tiempo.
