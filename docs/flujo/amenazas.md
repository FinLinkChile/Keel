---
type: Amenazas
title: "Amenazas que el flujo debe resistir"
description: "Modelo de amenazas de Keel Trade: cada amenaza con su ejemplo, la defensa y el riesgo residual declarado."
tags: [amenazas, seguridad, riesgo-residual]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-16T15:30:00Z }
---

| Amenaza | Ejemplo | Defensa | Riesgo residual |
| --- | --- | --- | --- |
| Cambio de cuenta por correo | "Nuestra cuenta cambió, paguen aquí" | `payoutAddress` va firmado por ambos; cambiarlo exige una orden nueva | Ingeniería social para que ambas partes firmen una orden nueva |
| BL falso | PDF de BL fabricado | Solo vale la atestación firmada por la naviera fijada en la orden | Llave de la naviera robada |
| Llave de la naviera robada | Atestaciones falsas | Naviera registrada y rotable; ventana de disputa; monitoreo | |
| Prompt injection en un documento (OWASP LLM01) | Texto oculto en el BL o la factura | Extractor sin herramientas, esquema sin texto libre, concordancia con el parser | El extractor puede devolver valores falsos; los frenan la firma de la naviera y el contrato |
| Agencia excesiva (OWASP LLM06) | El agente intenta una acción fuera de su tarea | Rol Zodiac limitado al escrow, con cupo | Acciones dentro del rol siguen siendo posibles |
| Mismo BL para dos órdenes | Cobrar dos veces con un embarque | Registro de `blNumberHash` usados, en ingesta y en el contrato | Depende de normalizar bien el número |
| Documento subido por quien no es parte | Un tercero sube un BL o una factura a una orden ajena | Solo se lee lo que firma con EIP-712 un representante registrado de la orden, sobre el hash exacto del archivo ([carga de documentos](../interfaces/carga-de-documentos.md)) | Llave de un representante robada: puede subir documentos, pero no cambia la orden ni el destino del pago |
| Proforma manipulada para prellenar la orden | Una proforma con un monto, un incoterm o una cuenta distintos, o con instrucciones para el modelo | La lectura solo devuelve campos tipados, nunca la cuenta de cobro; cada campo lo revisan las personas antes de firmar, y el motor compara la factura con la orden firmada ([lectura de la proforma](../interfaces/lectura-de-proforma.md)) | Una persona que firma sin revisar acepta el valor prellenado; la foto de una proforma va al modelo sin redactar |
| Inundación de documentos | Cientos de cargas para cansar al importador o gastar llamadas al LLM | Máximo 10 cargas firmadas por orden y por día, duplicados descartados por hash y alertas agrupadas en un resumen | |
| Llave del agente o del relayer robada | Intento de mover fondos | Sin PDR válido no pasa por el gate de Trade; el rol solo permite llamar al escrow, con cupo | Ninguna autoridad propia; puede gastar gas |
| Llave de política robada | PDR falsos | El Roles limita destino y cupo; el escrow solo paga a las partes de la orden; el gate de Trade solo deposita órdenes cuyo proveedor (exportador y `payoutAddress`) y cuyos naviera, árbitro y verificador están activos en los registros de la Safe, que solo la Safe agrega, con espera y veto (`FundingGate`) | Puede depositar, dentro del cupo, órdenes firmadas por ambas partes con proveedor y terceros ya aprobados, y aprobar documentos no conformes de las órdenes que nombran a esa llave como verificador. Con la llave del cosignatario además (nivel 3), lo mismo con el cupo mayor; nunca a una cuenta de cobro nueva (pruebas `test_goal_*` de `FundingGate.t.sol`) |
| Importador retira tras ver el embarque | Deja al exportador sin cobrar | El contrato no tiene función de retiro unilateral | Disputa de mala fe, que resuelve el árbitro |
| Exportador nunca embarca | Se queda con el anticipo | Reembolso del saldo por vencimiento | El anticipo no se recupera en la cadena: la disputa solo reparte el saldo restante y no se abre sin embarque. Queda para un acuerdo entre las partes fuera de la cadena |
| El motor no puede leer el BL o no responde | Saldo trabado aunque el embarque ocurrió | El importador aprueba a mano (`BalanceApproval`); una orden Embarcado no se reembolsa por vencimiento y va a disputa | Si el importador no aprueba, el exportador depende del árbitro |
| Colusión de exportador y naviera | Atestación de un embarque que no ocurrió | Ventana de disputa, árbitro, reputación e identidad verificada | Riesgo residual declarado |
| Árbitro corrupto | Reparte a favor de una parte | Solo puede repartir entre las partes; opción de 2 de 3 | Reparto injusto |
| Proveedor o naviera que la empresa no aprobó | Orden firmada por ambas partes con una cuenta de cobro nueva o con una naviera que controla el exportador | El gate de Trade exige proveedor y terceros activos en el registro de la Safe; agregar uno espera `configDelay` con veto por cambio | Los propios dueños de la Safe pueden encolar y esperar; la defensa es el aviso y el veto del cosignatario |
| Llave del guardian robada | Pausar el gate de Trade una y otra vez | El guardian solo puede llamar `emergencyPause`: no reanuda, no veta, no encola, no paga; la Safe lo quita con `setGuardian(address(0))` y reanuda en la misma transacción | Detiene depósitos hasta que la Safe lo quite; si eso pasa por el Delay, durante esa espera |
| Llave del cosignatario robada | Vetar toda alta de proveedor y pausar el gate de Trade | El cosignatario solo puede vetar cambios en cola y pausar: no agrega, no reanuda, no paga; la Safe lo reemplaza con `setCosigner` | Demora las altas y los depósitos hasta que la Safe lo rote |
| Decisión de documentos vieja | Un `DocumentDecision` firmado con una versión anterior de las reglas se usa para liberar el saldo | Ata la orden, la atestación aceptada y los documentos; vence en `expiresAt`; el saldo solo va al `payoutAddress` firmado | **Riesgo aceptado:** el escrow no lleva registro de política, así que no rechaza una versión vieja de `policyHash`; la limita solo `expiresAt`, y el verificador queda fijado en la orden (no se rota) |
| Exportador bloquea el reembolso con una disputa | Disputa abierta antes del embarque para congelar el saldo | `raiseDispute` solo desde Embarcado; sin embarque el reembolso sale tras el plazo | |
| Evento externo que amplía permisos (estilo Bankr) | Un NFT o un mensaje que cambia la configuración | Solo la Safe gobierna los módulos, por el Delay | Compromiso de la propia Safe |
| Repetición de firmas | Reusar la firma de una orden en otra | EIP-712 con `chainId`, contrato, `orderId` y `nonce` | Ninguna identificada en el diseño; lo demuestran las pruebas |
| Reentrancia | Token malicioso que reentra | Solo tokens permitidos; checks, effects, interactions; guard de reentrancia | |
| Aprobación ilimitada | El importador aprueba de más | `permit` o aprobación exacta | |
| Congelamiento del emisor | La stablecoin bloquea una dirección | Riesgo de emisor declarado; los fondos quedan en el escrow | |
| Suplantación de empresa | Alguien se hace pasar por el proveedor | Registro de partes verificadas e [identidad de empresas](../arquitectura/identidad-de-empresas.md) | |
| Caída o degradación del LLM | El extractor no responde | El motor determinista no depende del LLM | Las operaciones se retienen y se avisa |

Una celda vacía en riesgo residual significa que las fuentes todavía no lo declaran, no que no exista (D9).

Los riesgos declarados del prototipo y las métricas del red team están en [seguridad y red team](../entrega/seguridad-y-red-team.md). Las amenazas propias de Keel Personal y las de llaves comunes están en [amenazas de Keel Personal](../personal/amenazas.md). La custodia de llaves, con qué puede hacer cada llave robada y cómo se rota, está en [custodia de llaves](../arquitectura/custodia-de-llaves.md) (tarea T2.7).
