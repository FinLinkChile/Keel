# Arquitectura

* [Custodia y rotación de llaves](custodia-de-llaves.md) - Qué llaves existen, quién tiene cada una, qué puede hacer un atacante que robe una, dónde se limita y con qué prueba, cómo se rota y qué falta construir.
* [Evidencia y bitácora](evidencia-y-bitacora.md) - Qué queda registrado de cada intento, dónde se guardan los PDR y por qué los reverts deliberados son la evidencia más fuerte.
* [Verificador reproducible](verificador.md) - Cómo `keel verify` comprueba una decisión del motor desde la transacción o desde el archivo de evidencia, cómo la ancla a los contratos desplegados, qué prueba y qué no.
* [Identidad de las empresas](identidad-de-empresas.md) - Cómo se vincula una billetera con una empresa verificada: registros de la Safe en el gate de Trade en el prototipo, credenciales verificables y WeIdentity en producción.
* [Niveles de permiso (0 a 4)](niveles-de-permiso.md) - Los cinco niveles, dónde se hace cumplir cada uno y qué nivel tiene cada acción del agente en Keel Trade y en Keel Personal.
* [Piezas de la billetera y qué es el agente](piezas-de-la-billetera.md) - Safe, Zodiac Roles y Delay, PDRGate, PDR, motor, extractor y cosignatario: qué hace cada pieza, qué es 'el agente' y cómo opera una empresa desde su Safe.
* [Pipeline de documentos con extracción en cuarentena](pipeline-de-documentos.md) - Cómo se leen los documentos no confiables: LLM en cuarentena, parser determinista, concordancia y los límites que se declaran.
* [Stack tecnológico](stack.md) - Tecnología de cada componente: cuenta, permisos, escrow, red, token, cliente, simulación, lectura de documentos, aplicación y avisos.
