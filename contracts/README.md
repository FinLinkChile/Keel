# contracts (Area 1)

`TradeEscrow`, `PDRGate`, and the company wallet: Safe, Zodiac Roles Modifier v2 and Delay Modifier.

`TradeEscrow` holds the funds of each purchase order and moves them only through its state machine: advance when the order is signed by both parties and funded, balance when the shipment is proven, refund when the shipment deadline passes. The design is in section 5 of [docs/KEEL_SOLUCION_ALCANCE.md](../docs/KEEL_SOLUCION_ALCANCE.md), and the flow in [docs/flujo_clave.md](../docs/flujo_clave.md).

The network is a permissioned one and is not chosen yet (T1.0). Until then there is no chain id or RPC to configure.

## Setup

```sh
curl -L https://foundry.paradigm.xyz | bash && foundryup
cd contracts
forge install foundry-rs/forge-std
forge build
forge test
```

## What is here

* `src/KeelTypes.sol`: `PaymentIntent` and `PolicyDecision`, mirrored in `schemas/src/index.ts`. They belong to the previous scope (utility bill payments). To be replaced by `PurchaseOrder`, `ShipmentAttestation`, `FundIntent` and `DocumentDecision` once Area 2 freezes the new interfaces.
* `src/IPDRGate.sol`: `execute`, events and typed errors of the previous scope. To be migrated with the types.
* `test/`, `script/`: empty, ready for the negative battery, the escrow invariants and the deployment script.
* `deployments/<chainId>.json`: addresses consumed by the other areas (to be written by the deployment script).

## Invariants of the escrow

1. The total paid out never exceeds the amount deposited.
2. No funds leave to an address other than the importer or the payout address of the order.
3. A final state never moves funds again.
4. One bill of lading never settles two orders.

## Tasks

Tasks are described in [docs/keel_division_trabajo.md](../docs/keel_division_trabajo.md). Tasks that keep their number changed scope with the change of direction of October 13.

| Task | Issue |
|---|---|
| T1.0 Network and payment token | to be created |
| T1.1 Company Safe (importer and exporter) | #1 |
| T1.2 AGENT role in the Roles Modifier, limited to the escrow | #2 |
| T1.3 COSIGNER role in the Roles Modifier | #3 |
| T1.4 Delay Modifier for configuration changes | #4 |
| T1.5 ConfigGuard | #5 |
| T1.6 PDRGate contract | #6 |
| T1.7 Negative test battery | #7 |
| T1.8 Deployment and verification | #8 |
| T1.9 TradeEscrow contract | to be created |
| T1.10 Escrow invariants with fuzzing | to be created |
| T1.11 Party registry | to be created |
