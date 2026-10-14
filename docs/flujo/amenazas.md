---
type: Amenazas
title: "Amenazas que el flujo debe resistir"
description: "Modelo de amenazas de Keel Trade: cada amenaza con su ejemplo, la defensa y el riesgo residual declarado."
tags: [amenazas, seguridad, riesgo-residual]
modo: trade
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

| Amenaza | Ejemplo | Defensa | Riesgo residual |
| --- | --- | --- | --- |
| Cambio de cuenta por correo | "Nuestra cuenta cambió, paguen aquí" | `payoutAddress` va firmado por ambos; cambiarlo exige una orden nueva | Ingeniería social para que ambas partes firmen una orden nueva |
| BL falso | PDF de BL fabricado | Solo vale la atestación firmada por la naviera fijada en la orden | Llave de la naviera robada |
| Llave de la naviera robada | Atestaciones falsas | Naviera registrada y rotable; ventana de disputa; monitoreo | |
| Prompt injection en un documento (OWASP LLM01) | Texto oculto en el BL o la factura | Extractor sin herramientas, esquema sin texto libre, concordancia con el parser | El extractor puede devolver valores falsos; los frenan la firma de la naviera y el contrato |
| Agencia excesiva (OWASP LLM06) | El agente intenta una acción fuera de su tarea | Rol Zodiac limitado al escrow, con cupo | Acciones dentro del rol siguen siendo posibles |
| Mismo BL para dos órdenes | Cobrar dos veces con un embarque | Registro de `blNumberHash` usados | Depende de normalizar bien el número |
| Llave del agente o del relayer robada | Intento de mover fondos | Sin PDR válido no pasa por PDRGate; el rol solo permite llamar al escrow, con cupo | Ninguna autoridad propia; puede gastar gas |
| Llave de política robada | PDR falsos | El Roles limita destino y cupo; el escrow solo paga a las partes de la orden | Puede depositar órdenes firmadas dentro del cupo y aprobar documentos no conformes |
| Importador retira tras ver el embarque | Deja al exportador sin cobrar | El contrato no tiene función de retiro unilateral | Disputa de mala fe, que resuelve el árbitro |
| Exportador nunca embarca | Se queda con el anticipo | Reembolso del saldo por vencimiento | El anticipo solo se recupera por disputa |
| Colusión de exportador y naviera | Atestación de un embarque que no ocurrió | Ventana de disputa, árbitro, reputación e identidad verificada | Riesgo residual declarado |
| Árbitro corrupto | Reparte a favor de una parte | Solo puede repartir entre las partes; opción de 2 de 3 | Reparto injusto |
| Evento externo que amplía permisos (estilo Bankr) | Un NFT o un mensaje que cambia la configuración | Solo la Safe gobierna los módulos, por el Delay | Compromiso de la propia Safe |
| Repetición de firmas | Reusar la firma de una orden en otra | EIP-712 con `chainId`, contrato, `orderId` y `nonce` | Ninguna identificada en el diseño; lo demuestran las pruebas |
| Reentrancia | Token malicioso que reentra | Solo tokens permitidos; checks, effects, interactions; guard de reentrancia | |
| Aprobación ilimitada | El importador aprueba de más | `permit` o aprobación exacta | |
| Congelamiento del emisor | La stablecoin bloquea una dirección | Riesgo de emisor declarado; los fondos quedan en el escrow | |
| Suplantación de empresa | Alguien se hace pasar por el proveedor | Registro de partes verificadas e [identidad de empresas](../arquitectura/identidad-de-empresas.md) | |
| Caída o degradación del LLM | El extractor no responde | El motor determinista no depende del LLM | Las operaciones se retienen y se avisa |

Una celda vacía en riesgo residual significa que las fuentes todavía no lo declaran, no que no exista (D9).

Los riesgos declarados del prototipo y las métricas del red team están en [seguridad y red team](../entrega/seguridad-y-red-team.md). Las amenazas propias de Keel Personal y las de llaves comunes están en [amenazas de Keel Personal](../personal/amenazas.md). La custodia de llaves es la tarea T2.7 del [Área 2](../trabajo/area-2-motor.md).
