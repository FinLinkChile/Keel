---
type: Interfaz
title: "PDR: Registro de Decisión de Política"
description: "Qué es un PDR, en qué dos momentos se emite, los structs PolicyDecision y DocumentDecision y el dominio EIP-712."
tags: [pdr, policy-decision, document-decision, eip-712, pace]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-15T15:00:00Z }
---

Adoptado del marco académico PACE (Policy-Attested Contract Execution, arXiv 2608.17220), cuyo axioma es el mismo de Keel: el LLM propone, el verificador dispone y la cadena hace cumplir.

Keel emite un PDR en dos momentos:

| Momento | Qué decide el motor | Quién lo verifica en la cadena |
|---|---|---|
| Depósito | Que la orden está firmada, el proveedor es conocido y el monto cabe en el cupo | El gate de Trade, antes de ejecutar por el Roles Modifier |
| Gatillo 2 | Que el BL y la factura coinciden con la orden y con la atestación de la naviera | TradeEscrow, al liberar el saldo (`releaseBalance`) |

Flujo por decisión:

1. El motor de reglas determinista (función pura, sin acceso al LLM ni a la red) valida la intención contra la política.
2. La llamada exacta se simula con `eth_call` (D7).
3. Se emite un PDR firmado con EIP-712 que enlaza: hash de la intención, versión de la política, entradas usadas y hash keccak256 del calldata exacto.
4. Cualquier divergencia de un byte entre lo aprobado y lo enviado invalida la ejecución.

En las evaluaciones del paper, PACE logró 0,00 de ejecuciones inseguras con 0% de falsos positivos sobre 2.800 ensayos. Implementar una versión de este registro convierte "tenemos reglas" en "tenemos un compromiso criptográfico verificable por transacción".

# Structs

**Común a los dos modos:**

```solidity
struct PolicyDecision {
    bytes32 intentHash;     // hash EIP 712 de PaymentIntent (Personal) o de FundIntent (Trade)
    bytes32 calldataHash;   // keccak256 del calldata exacto que ejecuta la Safe
    bytes32 policyHash;     // versión vigente de las reglas
    bytes32 inputsHash;     // Personal: tipo de cambio, fuentes, versión de lista blanca
                            // Trade: orden, registro de proveedores, cupo usado
    uint8   tier;           // 1 o 3 (los niveles 0, 2 y 4 no llegan al gate)
    uint64  expiresAt;
}
```

**Trade (agregado):**

```solidity
struct DocumentDecision {
    bytes32 orderId;
    bytes32 attestationHash; // hash EIP 712 de ShipmentAttestation
    bytes32 docsHash;        // hash del paquete de documentos leído
    bytes32 policyHash;
    bytes32 inputsHash;      // extracciones del BL y de la factura
    uint64  expiresAt;
}
```

* Dominio EIP 712: `name = "Keel"`, `version = "1"`, `chainId`, y como `verifyingContract` el contrato que verifica cada firma (el gate del modo para `PolicyDecision`: PDRGate en Personal, el gate de Trade en Trade; TradeEscrow para la orden, la atestación y `DocumentDecision`).
* `FundIntent` incluye `orderHash`, el hash EIP-712 de la orden que firmaron ambas partes, para que el gate de Trade compruebe en la cadena que se deposita exactamente esa orden.
* El PDR completo, en JSON con las reglas evaluadas y sus resultados, se guarda fuera de cadena en `evidence/pdr/<pdrHash>.json`, donde `pdrHash` es el digest EIP-712 de la decisión que PDRGate emite en su evento. En cadena va ese hash. Lo genera `engine/src/pdr.ts` (`saveEvidence`).
* En nivel 3, el motor entrega al Área 4 una solicitud de cofirma (`cosignRequest`): el mismo digest y los datos tipados que la billetera del cosignatario firma con `signTypedData`.
* **Decidido por las Áreas 1 y 2 (14 de octubre): un gate por modo.** PDRGate es el gate de Keel Personal (`PaymentIntent`, transferencia a un beneficiario de la lista blanca). Keel Trade tiene su propio gate (nombre provisional `FundingGate`), que recibe `FundIntent` y arma por dentro el depósito en el escrow. La estructura interna de los gates (si comparten código y cómo) la define el Área 1. Razones: cada gate queda atado a una sola Safe y una billetera usa un solo modo, así que un gate con dos entradas desplegaría en cada billetera una función que nunca debe usarse, y cada modo versiona sus reglas por separado.
* **Decidido por las Áreas 1 y 2 (decisión 3):** el `DocumentDecision` es obligatorio para liberar el saldo y lo firma el `documentVerifier` fijado en cada orden. El motor solo lo firma si su llave es ese verificador (`signDocumentDecision`). La alternativa manual es la `BalanceApproval` del importador ([paso 5](../flujo/paso-5-saldo.md)).
* **[PROPUESTA] Área 2 (15 de octubre): qué es el `policyHash` de Keel Trade.** Es el keccak256 del JSON canónico de `{ mode: "trade", rulesVersion, funding, rolesConfigHash }`: la versión de las reglas (`TRADE_RULES_VERSION`), los parámetros del motor de depósito y el hash del archivo de configuración de Roles que versiona el Área 1 (`rolesConfigHash`, **pendiente**: el Área 1 lo define en el script de despliegue, T1.8, como el keccak256 del JSON canónico de la configuración de Roles que aplica, con una prueba que la compara con la de la cadena). Un solo hash firma el depósito y el `DocumentDecision`. Al desplegar, el gate de Trade se configura con `tradePolicyHash` (`engine/src/policy.ts`). Una prueba falla si cambian las reglas sin revisar la versión.
