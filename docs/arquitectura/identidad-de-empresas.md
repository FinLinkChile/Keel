---
type: Arquitectura
title: "Identidad de las empresas"
description: "Cómo se vincula una billetera con una empresa verificada: registros de la Safe en el gate de Trade en el prototipo, credenciales verificables y WeIdentity en producción."
tags: [identidad, party-registry, weidentity, kyb]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T16:30:00Z }
---

Una firma de billetera prueba que firmó **una llave**, no **quién** está detrás. Para comercio real hace falta vincular cada billetera con una empresa verificada:

1. **Prototipo [PROPUESTA del Área 1, 15 de octubre]:** cada empresa importadora lleva en su gate de Trade (`FundingGate`) sus propios registros: proveedores conocidos (exportador y `payoutAddress`) y terceros de confianza (naviera, árbitro y verificador de documentos). Los agrega solo su Safe, después de verificar fuera de la cadena, y cuentan tras una espera con veto. El gate no deposita una orden cuyas partes no estén activas. No hay un `PartyRegistry` administrado por Keel y `open` no revisa registros: lo que protege es que el dinero de la empresa no sale hacia partes que ella no aprobó.
2. **Producción:** credenciales verificables (estándar W3C) emitidas por una entidad confiable que digan "esta billetera representa a esta empresa". WeBank tiene su propia solución, **WeIdentity**, que corre sobre FISCO BCOS. Integrarla exigiría un puente o desplegar en FISCO BCOS. **[DISEÑO]**
3. **Validez legal en Chile:** la firma electrónica avanzada (Ley 19.799) da a una firma digital el valor de la firma manuscrita. Vincularla con la billetera es trabajo futuro. **[ABIERTO]**
