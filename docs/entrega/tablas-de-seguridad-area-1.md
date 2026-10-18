---
type: Entrega
title: "Tablas de seguridad del Área 1"
description: "Insumo del Área 1 para el informe de seguridad de Keel Trade: dónde se hace cumplir cada garantía de los contratos, con su prueba y su caso de evidencia en cadena; qué significa cada error en cadena para una persona; y los riesgos declarados del Área 1."
tags: [informe-de-seguridad, area-1, contratos, errores, riesgos, evidencia]
modo: trade
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-17T05:00:00Z }
---

Lo prepara el Área 1 como insumo de la tarea T5.3 del [Área 5](../trabajo/area-5-redteam-evidencia.md), que decide cómo entra al [informe de seguridad](seguridad-y-red-team.md) (en inglés para el jurado). Cubre solo los contratos y el despliegue de Keel Trade (`contracts/`).

* **Pruebas:** cada nombre es una función de `contracts/test/` y pasa con `forge test`. Las del gate están en `FundingGate.t.sol` y las del escrow en `TradeEscrow.t.sol`. Algunos nombres se repiten en `PDRGate.t.sol`, que es de Keel Personal y no cuenta aquí. Las que empiezan con `test_fork_` están en `test/fork/FundingGateRoles.fork.t.sol` y `test/fork/DeployTrade.fork.t.sol`, y corren contra Safe 1.4.1, Zodiac Roles 2.1.1, Delay 1.1.0 y el USDC reales sobre un fork de Base Sepolia.
* **Evidencia:** número de caso del script del Área 1 (`redteam/src/evidence/area1/`). "Sin caso" significa que el script no lo envía todavía. La columna de hash se completa después del despliegue real; hoy los casos solo corrieron sobre un fork local.

# Dónde se hace cumplir cada garantía

| Garantía | Dónde se hace cumplir | Prueba | Evidencia | Hash |
| --- | --- | --- | --- | --- |
| Un depósito exige una PDR vigente firmada por la llave de política sobre el intent exacto, una sola vez | `FundingGate.execute`, pasos b y g (`PDRVerifier._verifyPolicy`) | `test_revert_BadPolicySignature_attackerKey`, `test_revert_IntentMismatch_amountChangedAfterSigning`, `test_revert_StalePolicy`, `test_revert_Expired_decision`, `test_revert_NonceUsed_sameNonceOnAnotherOrder` | 1.7 | pendiente |
| El calldata lo arma el gate; la PDR solo lo aprueba por su hash | `FundingGate.execute`, paso f | `test_revert_CalldataMismatch`, `test_fundingCalldataOf_matchesTheEngineFormula` | 1.6 | pendiente |
| Solo se deposita la orden abierta que la Safe firmó como importador, en su versión exacta | `FundingGate.execute`, pasos c y d | `test_revert_NotOwnOrder_importerIsAnotherCompany`, `test_revert_OrderNotOpen_alreadyFunded`, `test_revert_OrderMismatch_orderHashOfAnotherVersion`, `test_revert_OrderMismatch_amountBelowOrderTotal` | 1.5, 3.1 | pendiente |
| Con el gate en pausa no sale ningún depósito | `FundingGate.execute`, paso a | `test_revert_GateIsPaused` | 1.9 | pendiente |
| Se paga solo a un proveedor conocido: el par (exportador, `payoutAddress`) activo en el registro de la Safe | `FundingGate.execute`, paso e | `test_revert_UnknownSupplier_newPayoutAddress`, `test_revert_UnknownSupplier_knownPayoutWithAnotherExporter`, `test_goal_stolenPolicyKey_newPayoutReverts`, `testFuzz_fundingImpliesActiveSupplier` | 1.3 | pendiente |
| La naviera, el árbitro y el verificador de la orden son terceros de confianza activos con ese rol | `FundingGate.execute`, paso e | `test_revert_UntrustedParty_carrier`, `test_revert_UntrustedParty_arbiter`, `test_revert_UntrustedParty_verifier`, `test_revert_UntrustedParty_trustedForAnotherRole`, `test_goal_exporterControlledCarrierReverts` | 1.4 | pendiente |
| Un alta cuenta recién después de `configDelay` | `FundingGate._active` | `test_revert_UnknownSupplier_oneSecondBeforeActivation`, `test_revert_UnknownSupplier_fundingRightAfterQueueing`, `test_revert_UntrustedParty_thirdPartyNotYetActive`, `test_onboarding_queueWaitFund` | 1.1 | pendiente |
| Cada alta pendiente se veta por separado; el cosignatario solo quita | `FundingGate.vetoPending` | `test_veto_bySafe`, `test_veto_byCosignerKeepsSupplierUnknown`, `test_veto_byCosignerKeepsThirdPartyUntrusted`, `test_veto_isIndividual`, `test_revert_ChangeNotPending_afterActivation` | 1.2 | pendiente |
| Solo la Safe agrega a los registros; ningún rol del Roles apunta al gate | `FundingGate` (`onlySafe`) y configuración del Roles | `test_revert_OnlySafe_queueSupplierByAttacker`, `test_revert_OnlySafe_cosignerCannotQueueSupplier`, `test_fork_invariant_noRoleTargetsTheGate` | sin caso | pendiente |
| Solo el gate puede ejecutar como la Safe a través del Roles | Roles (módulos habilitados y membresía) | `test_fork_revert_NotAuthorized_relayerCallsRolesDirectly`, `test_fork_revert_NoMembership_moduleWithoutTheRole`, `test_fork_checks_failWhenAnOutsiderIsAMember` | 1.8 | pendiente |
| El rol del agente solo permite `approve` al escrow y `fund`: sin `transfer`, otro destino, `delegatecall` ni valor | Roles (condiciones de AGENT y AGENT_COSIGNED) | `test_fork_revert_ConditionViolation_approveOtherSpender`, `test_fork_revert_ConditionViolation_transferWithAgentRole`, `test_fork_revert_ConditionViolation_otherTarget`, `test_fork_revert_ConditionViolation_delegatecallScopedTarget`, `test_fork_revert_ConditionViolation_delegatecallUnscopedTarget`, `test_fork_revert_ConditionViolation_valueToFund` | sin caso | pendiente |
| Cupo por período: nivel 1 hasta `AGENT_CAP`; no queda aprobación sobrante | Roles (cupos) y `FundingGate.execute`, paso i | `test_fork_revert_ConditionViolation_AllowanceExceeded_tier1OverCap`, `test_fork_checks_failWhenMaxRefillDiffersFromRefill`, `test_revert_AllowanceNotConsumed`, `test_fork_allowanceNotConsumed_whenFundRevertsInsideSafe` | sin caso | pendiente |
| Nivel 3 exige la cofirma y usa el rol de cupo mayor; la cofirma nunca salta los registros | `PDRVerifier._verifyCosignature` y Roles (AGENT_COSIGNED) | `test_revert_MissingCosignature_tier3WithoutCosigner`, `test_revert_MissingCosignature_policyKeyAsCosigner`, `test_tier3_fundsOverAgentCapWithCosignedRole`, `test_fork_tier3_fundsWithCosignedRole`, `test_goal_stolenPolicyAndCosignerKeys_tier3StillReverts` | sin caso | pendiente |
| La orden la firman importador y exportador sobre los mismos datos, incluida la `payoutAddress` | `TradeEscrow.open` | `test_revert_BadImporterSignature_payoutSwappedAfterSigning`, `test_revert_BadExporterSignature_wrongKey`, `test_revert_BadImporterSignature_safe1271Rejects`, `test_revert_BadOrderId_squatVictimId` | 1.3 a 1.7 (apertura) | pendiente |
| El depósito es exacto y solo del importador | `TradeEscrow.fund` | `test_revert_NotParty_fundByStranger`, `test_revert_AmountMismatch_feeOnTransferToken`, `test_revert_InvalidState_fundTwice`, `test_revert_DeadlinePassed_fundAtDeadline` | sin caso | pendiente |
| El embarque solo se acepta con la firma de la naviera de la orden, a tiempo y con un BL que no se haya usado | `TradeEscrow.submitShipment` | `test_revert_BadCarrierSignature_otherKey`, `test_revert_ShipmentTooLate_onBoardAfterDeadline`, `test_revert_BillOfLadingAlreadyUsed_sameCarrierTwoOrders`, `test_revert_DeadlinePassed_shipmentOnceRefundable` | 3.3, 3.4 | pendiente |
| Máquina de estados: disputa solo desde Embarcado, nada se mueve en un estado final | `TradeEscrow` (todas las funciones) | `test_revert_InvalidState_disputeFromAdvancePaid_byExporter`, `test_dispute_cannotBlockRefundDue`, `test_revert_InvalidState_finalSettled`, `test_revert_InvalidState_finalRefunded`, `test_revert_InvalidState_refundAfterShipped` | 3.2 | pendiente |
| Los fondos solo salen al importador o a la `payoutAddress`, y lo pagado suma lo depositado | `TradeEscrow._pay`, `resolve` y `cancel` | `testFuzz_payoutsEqualTotal`, `test_revert_BadResolution_sumBelowBalance`, `test_revert_BadArbiterSignature_otherKey`, `test_revert_ReentrancyGuardReentrantCall_crossFunction` | sin caso | pendiente |
| Quien frena no roba: el cosignatario pausa y veta; el guardian solo pausa; ninguno de los dos reanuda, agrega ni firma como política | `FundingGate.emergencyPause`, `vetoPending` y `onlySafe` | `test_emergencyPause_byCosigner`, `test_guardian_pauses`, `test_emergencyPause_bySafe`, `test_revert_OnlyPauser_emergencyPauseByAttacker`, `test_revert_OnlySafe_cosignerCannotUnpause`, `test_revert_OnlySafe_guardianCannotUnpause`, `test_revert_OnlySafeOrCosigner_guardianCannotVeto`, `test_revert_OnlySafe_guardianCannotQueue`, `test_revert_OnlySafe_guardianCannotRemove`, `test_revert_OnlySafe_guardianCannotConfigure`, `test_revert_BadPolicySignature_cosignerCannotActAsPolicy` | 1.9 (pausa por la Safe; la pausa por el cosignatario o el guardian no tiene caso) | pendiente |
| Solo la Safe fija o retira el guardian; no puede ser la llave de política, el cosignatario ni la Safe; un guardian robado se recupera retirándolo y reanudando | `FundingGate.setGuardian` y el chequeo de `setPolicySigner` y `setCosigner` | `test_guardian_startsUnset`, `test_setGuardian_bySafeEmits`, `test_revert_OnlySafe_setGuardianByAttackerOrCosigner`, `test_revert_InvalidGuardian_equalToPolicySignerCosignerOrSafe`, `test_revert_SignerIsGuardian_setPolicySignerOrCosigner`, `test_guardian_zeroDisables`, `test_guardian_rotation`, `test_guardian_compromisedRecovery` | sin caso | pendiente |
| Botón de pánico de Trade: el freno es la pausa del gate (cosignatario, guardian o Safe). Revocar el rol AGENT lo puede hacer la Safe en el Roles | `FundingGate.emergencyPause` y `pause`; revocación con `assignRoles` del Roles | Pausa: `test_revert_GateIsPaused`, `test_emergencyPause_byCosigner`, `test_guardian_pauses`. Revocación: sin prueba propia en Trade (en Personal, `test_panic_revokeAgentRole_stopsPayments` sobre PDRGate) | 1.9 | pendiente |
| Cambiar el `policyHash` pasa por el Delay: 180 s de espera, vence a 1 día y la Safe puede vetar lo encolado | Delay 1.1.0 (`executeNextTx` y `setTxNonce`) | `test_fork_delay_executeNextTxRevertsInCooldown`, `test_fork_delay_executeNextTxRevertsOnceExpired`, `test_fork_delay_ownerVetoesWithSetTxNonce` | sin caso | pendiente |
| El despliegue solo se publica si queda como se espera (dueños exactos, umbral, módulos, cupos, firmantes, guardian) | `DeployTrade.record` | `test_fork_record_refusesASafeWithAnotherOwner`, `test_fork_record_refusesARepeatedOwnerInTheEnv`, `test_fork_record_refusesAnotherGuardian`, `test_fork_record_refusesAUsedDeployment`, `test_fork_checks_failWithAnExtraSafeModule`, `test_fork_deploy_setsTheGuardian` | sin caso | pendiente |
| La Safe de la demo tiene 2 dueños con umbral 1 (OWNER y la llave de la app); cualquiera de los dos firma órdenes como importador por ERC-1271 | Safe 1.4.1 (`DeployTrade` fija los dueños) y `TradeEscrow.open` | `test_fork_deploy_handsTheSafeToThreeOwners`, `test_fork_deploy_withoutExtraOwners`, `test_fork_deploy_onlyTheThirdOwner`, `test_fork_deploy_secondOwnerSignsTheOrderThroughERC1271`, `test_fork_deploy_thirdOwnerSignsTheOrderThroughERC1271` | sin caso propio (el script exige que OWNER sea dueño y umbral 1 antes de cada fase) | pendiente |

Notas de alcance de la tabla:

* **Guardian:** es una llave opcional (`GUARDIAN_ADDRESS`, la del monitor) que solo puede llamar `emergencyPause`. La fija `DeployTrade` y la cambia o retira la Safe con `setGuardian`.
* **Delay:** las tres pruebas llaman directo al contrato Delay sobre el fork, que revierte por su cuenta: durante la espera, después del vencimiento y cuando la Safe vetó la cola con `setTxNonce`. Las pruebas `test_fork_setTradePolicy_*` cubren además las comprobaciones que hace el script `SetTradePolicy` antes de enviar. Sin ConfigGuard, una dueña de la Safe puede saltarse el Delay con una transacción directa (riesgo 2).
* **Botón de pánico:** en Trade el freno es la pausa del gate. La Safe también puede revocar el rol AGENT en el Roles, pero eso no tiene prueba propia en Trade.

# Qué significa cada error en cadena

Frase para la app y el bot: qué pasó y qué hacer. Los errores que solo pueden aparecer al desplegar o configurar están en la última tabla.

## Gate de Trade (FundingGate)

| Error | Frase |
| --- | --- |
| `GateIsPaused` | Los pagos están en pausa por seguridad. Ningún pago sale hasta que la empresa los reanude desde su Safe. |
| `IntentMismatch` | La aprobación no corresponde a este pago: algo cambió después de aprobarlo. Hay que volver a pedir la aprobación. |
| `OrderMismatch` | El pago no coincide con la orden firmada (otra versión, otro monto, otro token u otro escrow). Revisa la orden y vuelve a pedirlo. |
| `OrderNotOpen` | Esta orden no espera depósito: no existe, ya se depositó o está cerrada. No hay que hacer nada más. |
| `NotOwnOrder` | La orden no la firmó tu empresa como importadora. No se paga. |
| `UnknownSupplier` | La cuenta de cobro de este proveedor no está aprobada por tu empresa. Agrégala desde la Safe y espera el plazo de seguridad. |
| `UntrustedParty` | La naviera, el árbitro o el verificador de la orden no están aprobados por tu empresa con ese rol. Apruébalos y espera el plazo de seguridad. |
| `CalldataMismatch` | La aprobación era para otra operación distinta de este depósito. No se paga; avisa al equipo. |
| `InvalidTier` | La aprobación trae un nivel que no se paga automáticamente. Requiere revisión humana. |
| `BadPolicySignature` | La aprobación no está firmada por el motor de reglas de Keel. No se paga; avisa al equipo. |
| `StalePolicy` | La aprobación se hizo con una versión antigua de las reglas. Hay que volver a evaluar el pago. |
| `Expired` | La aprobación venció antes de ejecutarse. Hay que volver a pedirla. |
| `NonceUsed` | Esta aprobación ya se usó una vez. No se repite un pago. |
| `MissingCosignature` | Este monto necesita la cofirma y no llegó, o no es válida. Pídela al cofirmante. |
| `ExecutionFailed` | La billetera no pudo ejecutar el depósito. No se movió nada; avisa al equipo. |
| `AllowanceNotConsumed` | El depósito dejó una aprobación de fondos sin usar y se canceló entero. No se movió nada; avisa al equipo. |
| `OnlySafe` | Solo la Safe de la empresa puede hacer este cambio. |
| `OnlySafeOrCosigner` | Solo la Safe o el cofirmante pueden vetar un cambio pendiente. |
| `OnlyPauser` | Solo la Safe, el cofirmante o el guardian pueden pausar los pagos. |
| `ChangeNotPending` | Ese cambio ya no se puede vetar: ya se activó, se vetó o se quitó. Si no debía activarse, quítalo desde la Safe. |
| `AlreadyRegistered` | Esa cuenta o ese tercero ya está aprobado o en espera. No hace falta agregarlo otra vez. |
| `NotRegistered` | Esa cuenta o ese tercero no está en el registro. No hay nada que quitar. |
| `InvalidRoles` | El rol indicado no es válido: debe ser naviera, árbitro o verificador. |
| `ZeroAddress` | Falta una dirección (vacía). Revisa los datos. |

## Escrow (TradeEscrow)

| Error | Frase |
| --- | --- |
| `BadOrderId` | El identificador de la orden no corresponde a sus partes. Hay que generar la orden de nuevo. |
| `OrderExists` | Ya hay una orden con ese identificador. Una versión nueva de la orden necesita un número nuevo. |
| `TokenNotAllowed` | La orden usa un token que este escrow no acepta. |
| `InvalidOrder` | La orden está mal formada: faltan direcciones, se repite una persona en dos roles, el anticipo pasa del 100 % o el plazo ya pasó. Corrígela y fírmenla de nuevo. |
| `BadImporterSignature` | La firma del importador no corresponde a estos datos. Puede que la orden haya cambiado después de firmarla; fírmenla de nuevo. |
| `BadExporterSignature` | La firma del exportador no corresponde a estos datos. Puede que la orden haya cambiado después de firmarla; fírmenla de nuevo. |
| `InvalidState` | La orden no está en la etapa que permite esta acción (por ejemplo, disputar antes del embarque). Revisa el estado de la orden. |
| `NotParty` | Solo el importador o el exportador de la orden pueden hacer esto. |
| `DeadlinePassed` | El plazo ya pasó: no se puede depositar después de la fecha límite de embarque, ni registrar un embarque cuando ya corresponde el reembolso. |
| `AmountMismatch` | El escrow no recibió el monto exacto. No se registró el depósito. |
| `InvalidAttestation` | La atestación de embarque es de otra orden, o su fecha *on board* está en el futuro o es anterior al depósito. Hay que pedirle una nueva a la naviera. |
| `BadCarrierSignature` | La atestación no la firmó la naviera de la orden. No se acepta. |
| `ShipmentTooLate` | La fecha *on board* es posterior a la fecha límite de la orden. El embarque no se acepta; corresponde el reembolso al vencer el plazo de gracia. |
| `BillOfLadingAlreadyUsed` | Ese BL ya se usó en otra orden. No se acepta dos veces; revisa con la naviera. |
| `DeadlineNotReached` | Todavía no se puede: no ha terminado la ventana de disputa, o no ha vencido el plazo para el reembolso. Hay que esperar. |
| `BadDocumentDecision` | La aprobación de documentos no corresponde a este embarque, venció o no la firmó el verificador de la orden. El saldo no se libera. |
| `BadResolution` | El reparto de la disputa no suma exactamente el saldo que queda en el escrow. |
| `BadArbiterSignature` | La resolución no la firmó el árbitro de la orden, o se cambió el reparto después de firmarla. |
| `ReentrancyGuardReentrantCall` | Se intentó llamar al escrow desde dentro de otra llamada. Se rechazó; avisa al equipo. |
| `SafeERC20FailedOperation(token)` | El token rechazó la transferencia sin dar un motivo. No se movió nada; avisa al equipo. Con el USDC no debería aparecer, porque ese token revierte con su propio mensaje. |

## Roles (Zodiac Roles v2)

| Error | Frase |
| --- | --- |
| `NotAuthorized(sender)` | Esa cuenta no puede operar la billetera de la empresa. Solo el gate de Keel puede. |
| `NoMembership` | El módulo no tiene el rol que intenta usar. No se ejecutó nada. |
| `ModuleTransactionFailed` | La operación falló dentro de la Safe (por ejemplo, no hay saldo suficiente de USDC) y se canceló entera. Revisa el saldo. |
| `ConditionViolation` con Status 1 (`DelegateCallNotAllowed`) | La billetera no permite ese tipo de llamada. Bloqueado. |
| `ConditionViolation` con Status 2 (`TargetAddressNotAllowed`) | La billetera no puede llamar a ese contrato. Bloqueado. |
| `ConditionViolation` con Status 3 (`FunctionNotAllowed`) | Esa operación no está permitida para el agente (por ejemplo, una transferencia directa). Bloqueado. |
| `ConditionViolation` con Status 4 (`SendNotAllowed`) | La billetera no puede enviar ETH en esta operación. Bloqueado. |
| `ConditionViolation` con Status 7 (`ParameterNotAllowed`) | Un dato de la operación no está permitido (por ejemplo, aprobar fondos a otro contrato que no es el escrow). Bloqueado. |
| `ConditionViolation` con Status 10 (`ParameterNotAMatch`) | Un dato de la operación no coincide con lo permitido. Bloqueado. |
| `ConditionViolation` con Status 17 (`AllowanceExceeded`) | Se alcanzó el cupo de pagos del período. Espera el próximo período o usa el nivel con cofirma. |

## Solo al desplegar o configurar

| Error | Frase |
| --- | --- |
| `SignerIsCosigner` | La llave de política y la del cofirmante deben ser distintas. |
| `SignerIsGuardian` | La nueva llave de política o de cofirmante no puede ser la del guardian. Elige otra. |
| `InvalidGuardian` | El guardian no puede ser la llave de política, el cofirmante ni la propia Safe. Elige otra dirección. |
| `SameRoleKey` | Los roles de nivel 1 y nivel 3 deben ser distintos. |
| `InvalidDelay` | La espera de las altas es menor que el mínimo de 60 segundos. |
| `InvalidShortString`, `StringTooLong` | Error del EIP-712 de OpenZeppelin al construir el contrato. No puede ocurrir con el nombre fijo "Keel". |

Las frases de los errores de Roles valen para la configuración de `TradeRolesConfig`. El Status 10 no aparece en las pruebas de fork. Los errores del Delay y los de la Safe (`GS0xx`) no están en esta tabla porque la app y el bot no los muestran.

# Riesgos declarados del Área 1

Cada riesgo dice para quién vale y dónde está declarado. Ninguno se resuelve en la entrega.

1. **Una sola firma controla la Safe, y una de las llaves se comparte.** En la demo la Safe tiene 2 dueños con umbral 1: `OWNER_ADDRESS` y la llave de importador de la app (`SECOND_OWNER_ADDRESS`), que el equipo comparte entre varios teléfonos. Cualquiera de las dos basta para reconfigurar el Roles, los registros, el guardian y el `policyHash`, mover el USDC de la Safe, quitar a la otra dueña, desactivar el Delay y firmar como importador en el escrow. Que la llave de la app esté en varios teléfonos multiplica los lugares desde donde se puede robar; nunca vive en un servidor, pero los contratos no pueden hacerlo cumplir. En producción se usa un umbral mayor y una llave por dispositivo. Declarado en `DeployTrade.s.sol`.
2. **Sin ConfigGuard (T1.5, no construido), una dueña puede saltarse el Delay** y llamar directo `setPolicyHash`, los cambios de firmantes o el Roles. La espera de 180 s es una convención que la dueña respeta, no algo que los contratos hagan cumplir. Declarado en `SetTradePolicy.s.sol`.
3. **Las dueñas pueden aprobar a quien quieran.** Los registros del gate frenan a la IA, al agente, a la llave de política y al cosignatario, incluso robadas juntas, pero no a las dueñas de la Safe: pueden encolar una cuenta y esperar `configDelay`. La defensa es el veto durante la espera. Declarado en `FundingGate.sol`.
4. **Una llave del cosignatario o del guardian robada puede frenar los pagos.** La del cosignatario puede vetar todas las altas y pausar el gate; la del guardian (una llave de servidor del monitor, más expuesta) puede pausar, y volver a pausar después de cada reanudación. Ninguna de las dos puede agregar ni pagar. La recuperación es una sola transacción de la Safe que retira o rota la llave y reanuda; si esa transacción tiene que esperar en el Delay, el gate queda frenado durante la espera. Declarado en `FundingGate.sol`.
5. **Una disputa no tiene plazo.** Una vez en disputa, solo el árbitro o las dos partes juntas mueven el saldo; si el árbitro no responde y las partes no se ponen de acuerdo, el saldo queda en el escrow. Declarado en `TradeEscrow.sol`.
6. **El escrow no verifica la versión de las reglas al liberar el saldo.** Un `DocumentDecision` antiguo lo limita solo su `expiresAt`, y el verificador queda fijado en la orden (no se rota). Riesgo aceptado en [amenazas](../flujo/amenazas.md).
7. **El `orderId` no compromete los términos de la orden.** Si las partes firman dos versiones con el mismo nonce, gana la que se abra primero. Regla para el motor y la app: nonce nuevo por versión. Declarado en `TradeEscrow.sol`.
8. **La separación de roles del escrow solo compara direcciones exactas.** No detecta dos direcciones distintas de una misma persona o empresa. Que la naviera y el árbitro sean empresas reales no se verifica en la cadena: en la demo son llaves de prueba.
9. **El escrow es código propio sin auditoría externa.** Las invariantes con fuzz de T1.10 no están implementadas como suite de invariantes; solo existe la propiedad `testFuzz_payoutsEqualTotal`.
10. **El USDC tiene riesgo de emisor.** Una lista negra no impide `approve`, pero hace fallar cada depósito o pago por `transferFrom` o `transfer`, y los fondos pueden quedar en el escrow (observado en `test_fork_usdc_blacklistDoesNotStopApprove`).
11. **El botón de pánico de Trade es la pausa del gate** (cosignatario, guardian o Safe), probada y con caso de evidencia (1.9). Revocar el rol AGENT lo puede hacer la Safe en el Roles, pero no tiene prueba propia en Trade (sí en Personal).
12. **La evidencia en cadena todavía no existe en la red.** Los casos del script solo corrieron sobre un fork local; los hashes se completan después del despliegue real.
13. **El fork de prueba firma con las llaves reales de la demo bajo el chain id 84532,** así que sus transacciones firmadas serían válidas en Base Sepolia. Quedan dentro del anvil local, que se cierra al terminar. Declarado en el README del script.
