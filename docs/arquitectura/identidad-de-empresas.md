---
type: Arquitectura
title: "Identidad de las empresas"
description: "Cómo se vincula una billetera con una empresa verificada: PartyRegistry en el prototipo, credenciales verificables y WeIdentity en producción."
tags: [identidad, party-registry, weidentity, kyb]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

Una firma de billetera prueba que firmó **una llave**, no **quién** está detrás. Para comercio real hace falta vincular cada billetera con una empresa verificada:

1. **Prototipo:** un registro en cadena de partes verificadas, administrado por Keel (`PartyRegistry`). `open` exige que importador, exportador, naviera y árbitro estén registrados.
2. **Producción:** credenciales verificables (estándar W3C) emitidas por una entidad confiable que digan "esta billetera representa a esta empresa". WeBank tiene su propia solución, **WeIdentity**, que corre sobre FISCO BCOS. Integrarla exigiría un puente o desplegar en FISCO BCOS. **[DISEÑO]**
3. **Validez legal en Chile:** la firma electrónica avanzada (Ley 19.799) da a una firma digital el valor de la firma manuscrita. Vincularla con la billetera es trabajo futuro. **[ABIERTO]**
