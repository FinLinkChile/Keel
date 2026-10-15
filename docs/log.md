# Historial de la documentación

## 2026-10-14

* **Aprobación del Área 1 al PR #46**: la decisión 3 queda registrada como de las Áreas 1 y 2. `ESCROW_STATES` empieza con `NONE`, porque TradeEscrow usa 0 para "no hay orden". La tabla de llaves declara que en el prototipo una sola llave aprueba depósitos y da por conformes documentos. El Área 1 ajusta en su PR de TradeEscrow los detalles de la liberación (`releaseBalance` tras la ventana de disputa, `approveBalance` del importador, disputa sin límite de tiempo en Embarcado) ([paso 5](flujo/paso-5-saldo.md)).
* **Nuevo**: [bitácora del Área 2](trabajo/bitacora-area-2.md), con el resumen del día: entregas, decisiones, cambios de interfaz por área, hallazgos y pendientes. Pedida por Darienn (Área 2).
* **Revisión del Área 1 al PR #44**: la decisión de un gate por modo queda como de las Áreas 1 y 2, y la estructura interna de los gates la define el Área 1 (se retiró lo del contrato base compartido). `FundIntent` agrega `orderHash` para que el gate compruebe la orden en la cadena. El proveedor conocido de Trade hoy se revisa solo en el motor; el Área 1 lo llevará a la cadena (T1.11) y la documentación ya no afirma lo contrario. Para el nivel 3 sobre el cupo, Darienn (Área 2) eligió que el Área 1 agregue un segundo rol con cupo mayor que el gate usa solo con cofirma. `blNumberHash` pasa a ser `keccak256(abi.encode(carrier, number))`, porque un número de BL es único por naviera. Conceptos: [PDR](interfaces/pdr.md), [niveles de permiso](arquitectura/niveles-de-permiso.md), [piezas de la billetera](arquitectura/piezas-de-la-billetera.md), [amenazas](flujo/amenazas.md), [Área 1](trabajo/area-1-contratos.md).
* **Decisión 3 cerrada**: el `DocumentDecision` es obligatorio para liberar el saldo y lo firma el `documentVerifier` fijado en cada orden (nuevo campo de `PurchaseOrder`), que no puede ser una parte ni la naviera. Dos salidas: el importador puede aprobar el saldo a mano (`BalanceApproval`, struct nuevo) y una orden con la atestación registrada (estado Embarcado, nuevo) no se reembolsa por vencimiento. El gatillo 2 pasa a dos pasos (`submitShipment` y `releaseBalance`, nombres propuestos al Área 1). La tomó Darienn (Área 2). Conceptos: [paso 1](flujo/paso-1-firma-orden.md), [paso 5](flujo/paso-5-saldo.md), [paso 6](flujo/paso-6-reembolso.md), [estados](flujo/estados-del-escrow.md), [datos firmados](flujo/datos-firmados-e-interfaz.md), [PDR](interfaces/pdr.md), [custodia de llaves](arquitectura/custodia-de-llaves.md), [amenazas](flujo/amenazas.md), [Área 1](trabajo/area-1-contratos.md).
* **Decisión**: `termsHash` deja de ser el hash de un documento y pasa a ser el hash EIP-712 de `OrderTerms` (número de orden, moneda y monto de la factura, códigos arancelarios y hash del documento completo). Así ambas partes firman los datos contra los que el motor compara la factura en el gatillo 2. Afecta al Área 4 (la app arma `OrderTerms` al crear la orden) y al Área 3 (entrega el hash de cada archivo leído). La tomó Darienn (Área 2). Conceptos: [paso 1](flujo/paso-1-firma-orden.md), [paso 5](flujo/paso-5-saldo.md), [datos firmados](flujo/datos-firmados-e-interfaz.md).
* **Nuevo**: [custodia y rotación de llaves](arquitectura/custodia-de-llaves.md) (T2.7), con cada llave, qué puede hacer si la roban, dónde se limita, con qué prueba y qué está pendiente. Agrega dos llaves que la tabla original no tenía (deployer y tokens de la ingesta) y declara un riesgo: el token de administración de la ingesta puede relajar DMARC. En código, `engine/src/keys.ts` exige una llave por papel y que la llave de política solo firme PDR. Área 2 (Darienn).
* **Decisión**: un gate por modo. PDRGate queda para Keel Personal y Keel Trade tiene su propio gate (nombre provisional `FundingGate`), con la verificación del PDR compartida en un contrato base. D4 pasa a decir "el gate de cada Safe es el único miembro del rol del agente". La tomó Darienn (Área 2); si a un área le genera un problema, se revisa con él. Se retiró de las cuestiones abiertas. Conceptos: [PDR](interfaces/pdr.md), [transversales](decisiones/transversales.md), [piezas de la billetera](arquitectura/piezas-de-la-billetera.md), [niveles de permiso](arquitectura/niveles-de-permiso.md), [eventos y errores](interfaces/eventos-y-errores.md), [amenazas](flujo/amenazas.md), [Área 1](trabajo/area-1-contratos.md).
* **Decisión**: el archivo del PDR se llama `evidence/pdr/<pdrHash>.json`, con `pdrHash` igual al digest EIP-712 que PDRGate emite en `PaymentExecuted`, y en nivel 3 el motor entrega al Área 4 una solicitud de cofirma con ese mismo digest ([PDR](interfaces/pdr.md), [evidencia y bitácora](arquitectura/evidencia-y-bitacora.md)). Lo decidió el Área 2 (Darienn) al implementar T2.4; cierra el nombre pendiente del 13 de octubre.
* **Actualización**: [README](README.md) y la skill `keel-docs` indican ahora cuándo se actualiza la documentación. Criterio definido por Darienn: la prioridad es el avance del proyecto y la documentación sirve para mantener al equipo al día con las decisiones, así que nunca detiene una tarea y toda decisión que afecte a otra área se registra en el mismo cambio.

## 2026-10-13

* **Reestructuración**: la documentación pasó de cinco documentos largos a un bundle [OKF v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) de conceptos cortos, uno por archivo, organizados por carpetas. Las convenciones están en [README](README.md).
* **Fusión**: lo que estaba repetido en varios documentos quedó en un solo concepto. Donde diferían se aplicó la regla de precedencia (vale el flujo clave) y la diferencia quedó anotada abajo.
* **Sin cambios de fondo**: no se cerró ninguna decisión abierta ni se cambió el objetivo, el flujo ni el alcance.

### Diferencias resueltas al fusionar

* El PDR del motor en el gatillo 2 figuraba como "opcional" en el documento de alcance y como condición en el flujo clave. Quedó como condición, con la [decisión abierta 3](decisiones/abiertas.md) a la vista en el [paso 5](flujo/paso-5-saldo.md).
* El actor "Motor de Keel (opcional)" del documento de alcance quedó dentro de "Agente de Keel" en [actores](flujo/actores.md).
* El documento técnico decía "Pago de cuentas personales: fuera". Se retiró: Keel Personal volvió al alcance el 13 de octubre ([alcance](flujo/alcance.md)).
* Las preguntas abiertas del documento de alcance (8) y las del flujo clave (14) quedaron en una sola tabla, con la numeración del flujo clave ([decisiones abiertas](decisiones/abiertas.md)).
* Las tres tablas de amenazas de Keel Trade quedaron en una, con columna de riesgo residual ([amenazas](flujo/amenazas.md)).
* La ruta de los PDR figuraba como `evidence/pdr/<hash>.json` y como `evidence/pdr/<intentHash>.json`. Quedó la primera en [evidencia y bitácora](arquitectura/evidencia-y-bitacora.md); falta que el Área 2 confirme el nombre.

### Equivalencias con los documentos anteriores

Para ubicar una cita antigua del tipo "sección N de X".

| Documento anterior | Sección | Concepto actual |
| --- | --- | --- |
| `flujo_clave.md` | 1 | [flujo/objetivo](flujo/objetivo.md) |
| | 2.1, 2.2 | [arquitectura/piezas-de-la-billetera](arquitectura/piezas-de-la-billetera.md) |
| | 2.3, 7 | [arquitectura/niveles-de-permiso](arquitectura/niveles-de-permiso.md) |
| | 3 | [flujo/principios](flujo/principios.md) |
| | 4 | [flujo/problema](flujo/problema.md) |
| | 5 | [flujo/actores](flujo/actores.md) |
| | 6 | [flujo/flujo-clave](flujo/flujo-clave.md) |
| | 6.1 a 6.7 | `flujo/paso-0-negociacion` a `flujo/paso-6-reembolso` |
| | 6.8 | [flujo/disputa-y-cancelacion](flujo/disputa-y-cancelacion.md) |
| | 8 | [flujo/estados-del-escrow](flujo/estados-del-escrow.md) |
| | 9 | [flujo/datos-firmados-e-interfaz](flujo/datos-firmados-e-interfaz.md) |
| | 10 | [flujo/amenazas](flujo/amenazas.md) |
| | 11 | [trabajo/areas-y-carpetas](trabajo/areas-y-carpetas.md) |
| | 12 | [flujo/alcance](flujo/alcance.md) |
| | 13 | [flujo/checklist-componente](flujo/checklist-componente.md) |
| | 14 | [decisiones/abiertas](decisiones/abiertas.md) |
| `KEEL_SOLUCION_ALCANCE.md` | 1 | [flujo/objetivo](flujo/objetivo.md), [flujo/problema](flujo/problema.md) |
| | 2 | [flujo/alcance](flujo/alcance.md) |
| | 3, 7.3 | [flujo/principios](flujo/principios.md) |
| | 4 | [personal/keel-personal](personal/keel-personal.md) |
| | 5.1 a 5.11 | Los conceptos de `flujo/` de cada paso |
| | 5.12 | [arquitectura/piezas-de-la-billetera](arquitectura/piezas-de-la-billetera.md) |
| | 5.13 | [arquitectura/identidad-de-empresas](arquitectura/identidad-de-empresas.md) |
| | 5.14 | [flujo/datos-firmados-e-interfaz](flujo/datos-firmados-e-interfaz.md), [interfaces/eventos-y-errores](interfaces/eventos-y-errores.md) |
| | 6 | [pagos/sistema-de-pago](pagos/sistema-de-pago.md) |
| | 7.1 | [personal/amenazas](personal/amenazas.md) |
| | 7.2 | [flujo/amenazas](flujo/amenazas.md) |
| | 8 | [pagos/regulacion](pagos/regulacion.md) |
| | 9 | [decisiones/abiertas](decisiones/abiertas.md) |
| | 10 | [entrega/entregables](entrega/entregables.md) |
| | Anexo A | [contexto/glosario](contexto/glosario.md) |
| `keel_division_trabajo.md` | 1 | [decisiones/transversales](decisiones/transversales.md) |
| | 2 | [interfaces](interfaces/index.md) |
| | 2.1 | [interfaces/extraccion-de-documentos](interfaces/extraccion-de-documentos.md) |
| | 2.2 | [interfaces/intenciones](interfaces/intenciones.md) |
| | 2.3 | [interfaces/pdr](interfaces/pdr.md) |
| | 2.4 | [interfaces/eventos-y-errores](interfaces/eventos-y-errores.md) |
| | 2.5 | [trabajo/areas-y-carpetas](trabajo/areas-y-carpetas.md) |
| | 3 a 7 | `trabajo/area-1-contratos` a `trabajo/area-5-redteam-evidencia` |
| | 8, 9 | [trabajo/calendario](trabajo/calendario.md) |
| | 10 | [trabajo/recortes](trabajo/recortes.md) |
| | 11 | [trabajo/mapa-de-criticas](trabajo/mapa-de-criticas.md) |
| `keel-documento-tecnico.md` | 1, 2 | [contexto/posicionamiento](contexto/posicionamiento.md) |
| | 3.1 | [arquitectura/piezas-de-la-billetera](arquitectura/piezas-de-la-billetera.md) |
| | 3.2 | [flujo/estados-del-escrow](flujo/estados-del-escrow.md) |
| | 3.3 | [arquitectura/pipeline-de-documentos](arquitectura/pipeline-de-documentos.md) |
| | 3.4 | [interfaces/pdr](interfaces/pdr.md) |
| | 3.5 | [arquitectura/niveles-de-permiso](arquitectura/niveles-de-permiso.md) |
| | 3.6 | [arquitectura/evidencia-y-bitacora](arquitectura/evidencia-y-bitacora.md) |
| | 4, 10 | [trabajo/recortes](trabajo/recortes.md) |
| | 5 | [entrega/demo](entrega/demo.md) |
| | 6 | [contexto/alineacion-webank](contexto/alineacion-webank.md) |
| | 7, 8 | [flujo/amenazas](flujo/amenazas.md), [entrega/seguridad-y-red-team](entrega/seguridad-y-red-team.md) |
| | 9 | [arquitectura/stack](arquitectura/stack.md) |
| | 11 | [entrega/entregables](entrega/entregables.md) |
| | Anexo A | [contexto/respaldo-jurado](contexto/respaldo-jurado.md) |
| `reunion_comercio_exterior.md` | Completo | [contexto/entrevista-importador](contexto/entrevista-importador.md) |
