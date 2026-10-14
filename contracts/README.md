# contracts (Area 1)

`PDRGate`, `TradeEscrow`, and the wallet shared by both modes: Safe, Zodiac Roles Modifier v2 and Delay Modifier.

In Keel Personal, `PDRGate` verifies a `PaymentIntent` and the Safe transfers to a whitelisted beneficiary, inside the allowance of the agent role. Each invoice is paid at most once (`invoiceKey`).

In Keel Trade, `TradeEscrow` holds the funds of each purchase order and moves them only through its state machine: advance when the order is signed by both parties and funded, balance when the shipment is proven, refund when the shipment deadline passes. The design is in [docs/flujo/estados-del-escrow.md](../docs/flujo/estados-del-escrow.md) and [docs/flujo/datos-firmados-e-interfaz.md](../docs/flujo/datos-firmados-e-interfaz.md), and the flow in [docs/flujo/flujo-clave.md](../docs/flujo/flujo-clave.md).

The network for Keel Trade is a permissioned one and is not chosen yet (T1.0). Until then there is no chain id or RPC to configure. Keel Personal was designed on Base Sepolia with USDC; T1.0 also decides whether it moves to the same network.

## Setup

```sh
curl -L https://foundry.paradigm.xyz | bash && foundryup
cd contracts
forge install foundry-rs/forge-std
forge build
forge test
```

## What is here

* `src/KeelTypes.sol`: `PaymentIntent` and `PolicyDecision`, mirrored in `schemas/src/index.ts`. They are the Keel Personal types. `PurchaseOrder`, `ShipmentAttestation`, `FundIntent` and `DocumentDecision` are added once Area 2 freezes the Keel Trade interfaces.
* `src/IPDRGate.sol`: `execute`, events and typed errors of Keel Personal. Whether the same gate also takes `FundIntent` or there is one gate per mode is an open decision ([docs/interfaces/pdr.md](../docs/interfaces/pdr.md)).
* `test/`, `script/`: empty, ready for the negative battery, the escrow invariants and the deployment script.
* `deployments/<chainId>.json`: addresses consumed by the other areas (to be written by the deployment script).

## Invariants of the escrow

1. The total paid out never exceeds the amount deposited.
2. No funds leave to an address other than the importer or the payout address of the order.
3. A final state never moves funds again.
4. One bill of lading never settles two orders.

## Tasks

Tasks are described in [docs/trabajo/area-1-contratos.md](../docs/trabajo/area-1-contratos.md) (tasks T1.x). A task that exists in both modes keeps one number: its base text is Keel Personal and Keel Trade adds to it.

| Task | Issue |
|---|---|
| T1.0 Network and payment token (added by Trade) | to be created |
| T1.1 Base Safe (owner; importer and exporter) | #1 |
| T1.2 AGENT role in the Roles Modifier (whitelisted transfers; escrow funding) | #2 |
| T1.3 COSIGNER role in the Roles Modifier | #3 |
| T1.4 Delay Modifier for configuration changes | #4 |
| T1.5 ConfigGuard | #5 |
| T1.6 PDRGate contract | #6 |
| T1.7 Negative test battery | #7 |
| T1.8 Deployment and verification | #8 |
| T1.9 TradeEscrow contract (added by Trade) | to be created |
| T1.10 Escrow invariants with fuzzing (added by Trade) | to be created |
| T1.11 Party registry (added by Trade) | to be created |
