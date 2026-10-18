# Arquitectura

* [Despliegue en AWS](despliegue-aws.md) - Cómo se propone correr Keel en AWS sin servidores propios: principios, mapa de los conceptos de la arquitectura y por dónde entran las peticiones a la API (HTTP API con throttling ahora, REST API con WAF en producción).
* [Componentes de la arquitectura en AWS](aws-componentes.md) - Qué servicio de AWS cumple cada función de Keel Trade, qué hace, qué es hoy en el repo y si existe, es nuevo, cambia o falta decidirlo.
* [API y datos en AWS](aws-api-y-datos.md) - Las rutas de la API con quién las llama y cómo se autentica cada una, y las tablas y buckets que reemplazan a los archivos y al SQLite de hoy.
* [Llaves y secretos en AWS](aws-llaves-y-secretos.md) - Qué llaves pasan a KMS, cuáles nunca entran a AWS, qué secretos van en Secrets Manager y qué hace falta para firmar desde KMS.
* [Recorrido de una orden en AWS](aws-recorrido-de-una-orden.md) - Qué piezas intervienen en cada paso del flujo y cómo trabaja el agente por vueltas: cola por Safe, candado y nonce, evidencia antes de enviar, indexador y monitor.
* [Pendientes de la arquitectura en AWS](aws-pendientes.md) - Qué falta construir por área, qué decisiones abiertas toca y qué riesgos quedan declarados.
* [Custodia y rotación de llaves](custodia-de-llaves.md) - Qué llaves existen, quién tiene cada una, qué puede hacer un atacante que robe una, dónde se limita y con qué prueba, cómo se rota y qué falta construir.
* [Datos personales y privacidad (Ley 21.719)](datos-personales.md) - Qué datos de personas y empresas guarda Keel, dónde vive cada uno, para qué, a quién se transfiere, qué queda en la cadena, qué pueden usar los análisis y qué falta definir.
* [Evidencia y bitácora](evidencia-y-bitacora.md) - Qué queda registrado de cada intento, dónde se guardan los PDR y por qué los reverts deliberados son la evidencia más fuerte.
* [Servicio del agente](servicio-del-agente.md) - Qué hace el servicio del agente en cada vuelta, de dónde lee sus datos, qué avisos emite para el bot, dónde se conecta el gate de Trade y qué riesgo de llaves declara el prototipo.
* [Monitor de uso fuera del sistema](monitor.md) - Qué vigila el monitor (T2.8), cuándo pausa el gate de Trade y con qué llave, qué solo avisa y qué avisos envía al bot.
* [Verificador reproducible](verificador.md) - Cómo `keel verify` comprueba una decisión del motor desde la transacción o desde el archivo de evidencia, cómo la ancla a los contratos desplegados, qué prueba y qué no.
* [Identidad de las empresas](identidad-de-empresas.md) - Cómo se vincula una billetera con una empresa verificada: registros de la Safe en el gate de Trade en el prototipo, credenciales verificables y WeIdentity en producción.
* [Niveles de permiso (0 a 4)](niveles-de-permiso.md) - Los cinco niveles, dónde se hace cumplir cada uno y qué nivel tiene cada acción del agente en Keel Trade y en Keel Personal.
* [Piezas de la billetera y qué es el agente](piezas-de-la-billetera.md) - Safe, Zodiac Roles y Delay, PDRGate, PDR, motor, extractor y cosignatario: qué hace cada pieza, qué es 'el agente' y cómo opera una empresa desde su Safe.
* [Pipeline de documentos con extracción en cuarentena](pipeline-de-documentos.md) - Cómo se leen los documentos no confiables: LLM en cuarentena, parser determinista, concordancia y los límites que se declaran.
* [Stack tecnológico](stack.md) - Tecnología de cada componente: cuenta, permisos, escrow, red, token, cliente, simulación, lectura de documentos, aplicación y avisos.
