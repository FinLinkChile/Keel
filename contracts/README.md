# contracts (Area 1)

Safe, Zodiac Roles Modifier v2, Delay Modifier and `PDRGate` on Base Sepolia (chainId 84532).

## Setup

```sh
curl -L https://foundry.paradigm.xyz | bash && foundryup
cd contracts
forge install foundry-rs/forge-std
forge build
forge test
```

Fork tests read `BASE_SEPOLIA_RPC_URL` from the environment (see `.env.example` at the repository root).

## What is here

* `src/KeelTypes.sol`: `PaymentIntent` and `PolicyDecision`, mirrored in `schemas/src/index.ts`. Draft until the interface freeze.
* `src/IPDRGate.sol`: `execute`, the fixed event names and the typed errors.
* `test/`, `script/`: empty, ready for the negative battery and the deployment script.
* `deployments/84532.json`: addresses consumed by the other areas (to be written by the deployment script).

## Tasks

| Task | Issue |
|---|---|
| T1.1 Base Safe | #1 |
| T1.2 AGENT role in the Roles Modifier | #2 |
| T1.3 COSIGNER role in the Roles Modifier | #3 |
| T1.4 Delay Modifier for configuration changes | #4 |
| T1.5 ConfigGuard | #5 |
| T1.6 PDRGate contract | #6 |
| T1.7 Negative test battery on a fork | #7 |
| T1.8 Deployment and verification | #8 |
