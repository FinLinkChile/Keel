---
type: Interfaz
title: "PDR: Registro de Decisión de Política"
description: "Qué es un PDR, en qué dos momentos se emite, los structs PolicyDecision y DocumentDecision y el dominio EIP-712."
tags: [pdr, policy-decision, document-decision, eip-712, pace]
modo: ambos
status: draft
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T02:45:00Z }
---

Adoptado del marco académico PACE (Policy-Attested Contract Execution, arXiv 2608.17220), cuyo axioma es el mismo de Keel: el LLM propone, el verificador dispone y la cadena hace cumplir.

Keel emite un PDR en dos momentos:

| Momento | Qué decide el motor | Quién lo verifica en la cadena |
|---|---|---|
| Depósito | Que la orden está firmada, el proveedor es conocido y el monto cabe en el cupo | PDRGate, antes de ejecutar por el Roles Modifier |
| Gatillo 2 | Que el BL y la factura coinciden con la orden y con la atestación de la naviera | TradeEscrow, en `submitShipment` |

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

* Dominio EIP 712: `name = "Keel"`, `version = "1"`, `chainId`, y como `verifyingContract` el contrato que verifica cada firma (PDRGate para `PolicyDecision`, TradeEscrow para la orden, la atestación y `DocumentDecision`).
* El PDR completo, en JSON con las reglas evaluadas y sus resultados, se guarda fuera de cadena en `evidence/pdr/<hash>.json`. En cadena va su hash.
* **Abierto:** cómo acepta PDRGate las dos intenciones (`PaymentIntent` y `FundIntent`): un gate con dos entradas o un gate por modo. Lo deciden las Áreas 1 y 2 antes del congelamiento.
* **Abierto:** qué firmante de política acepta el escrow para `DocumentDecision` (uno registrado en el contrato o uno fijado en cada orden) y si esa decisión es obligatoria para liberar el saldo.
