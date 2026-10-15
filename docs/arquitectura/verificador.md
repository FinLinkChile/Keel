---
type: Arquitectura
title: "Verificador reproducible"
description: "Cómo `keel verify` comprueba una decisión del motor desde la transacción o desde el archivo de evidencia, qué prueba y qué no."
tags: [verificador, pdr, evidencia, t2-9, reproducible]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T15:00:00Z }
---

El [archivo del PDR](evidencia-y-bitacora.md) guarda también todo lo que la decisión usó (`replay`): la orden, el contexto leído en ese momento, las extracciones y la política con su versión de reglas. Con eso, `keel verify` (T2.9, `engine/src/verify.ts`) vuelve a correr las mismas reglas y compara cada hash:

* `npm run keel -- verify <txHash> --rpc <url>` lee la transacción, busca en sus eventos cada hash que tenga archivo en `evidence/pdr/` y además compara la red, el contrato que emitió el evento y lo que el evento dice de la decisión.
* `npm run keel -- verify --pdr <pdrHash>` verifica solo el archivo, sin red. Sirve mientras la [decisión abierta 13](../decisiones/abiertas.md) no diga cómo verifica el jurado en una red cerrada.

Muestra MATCH o MISMATCH por cada comprobación, con el valor esperado y el obtenido. Un PDR de Keel Personal se comprueba (firma, hashes y evento) pero no se vuelve a ejecutar hasta que exista su motor (T2.2). Una decisión hecha con otra versión de reglas tampoco se vuelve a ejecutar: el verificador pide usar el de esa versión.

Para quién vale: prueba que la decisión firmada sale de esas entradas con esas reglas y que la cadena aceptó ese mismo hash. No prueba que las entradas fueran ciertas (eso depende de la ingesta y del registro de partes). Las pruebas están en `engine/src/verify.test.ts`.

**Privacidad:** el archivo contiene datos comerciales de la orden (montos, proveedores conocidos, cupo, RUT del importador). En la demo son datos de prueba; en producción `evidence/` no es público.
