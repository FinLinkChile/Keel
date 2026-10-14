# contracts (Area 1)

`PDRGate`, `TradeEscrow`, and the wallet shared by both modes: Safe, Zodiac Roles Modifier v2 and Delay Modifier.

In Keel Personal, `PDRGate` verifies a `PaymentIntent` and the Safe transfers to a whitelisted beneficiary, inside the allowance of the agent role. Each invoice is paid at most once (`invoiceKey`).

In Keel Trade, `TradeEscrow` holds the funds of each purchase order and moves them only through its state machine: advance when the order is signed by both parties and funded, balance when the shipment is proven, refund when the shipment deadline passes. The design is in [docs/flujo/estados-del-escrow.md](../docs/flujo/estados-del-escrow.md) and [docs/flujo/datos-firmados-e-interfaz.md](../docs/flujo/datos-firmados-e-interfaz.md), and the flow in [docs/flujo/flujo-clave.md](../docs/flujo/flujo-clave.md).

The network for Keel Trade is a permissioned one and is not chosen yet (T1.0). Until then there is no chain id or RPC to configure. Keel Personal was designed on Base Sepolia with USDC; T1.0 also decides whether it moves to the same network.

## Setup

```sh
curl -L https://foundry.paradigm.xyz | bash && foundryup
git submodule update --init --recursive
cd contracts
forge build
forge test
```

Dependencies are git submodules under `contracts/lib/` (forge-std v1.17.0 and OpenZeppelin Contracts v5.6.1, pinned in `foundry.lock`; see `.gitmodules` at the repository root). CI checks them out with `submodules: recursive`.

Fork tests read `BASE_SEPOLIA_RPC_URL` from the environment through `rpc_endpoints.base_sepolia` in `foundry.toml` (see `.env.example` at the repository root). CI does not run them:

```sh
forge test --match-path 'test/fork/*' -vv
```

## What is here

| Path | Contents |
| --- | --- |
| `src/KeelTypes.sol` | `PaymentIntent` and `PolicyDecision`, mirrored in `schemas/src/index.ts`. They are the Keel Personal types. `PurchaseOrder`, `ShipmentAttestation`, `FundIntent` and `DocumentDecision` are added once Area 2 freezes the Keel Trade interfaces. Owned by Area 2. |
| `src/IPDRGate.sol` | `execute`, events and typed errors of Keel Personal. Whether the same gate also takes `FundIntent` or there is one gate per mode is an open decision ([docs/interfaces/pdr.md](../docs/interfaces/pdr.md)). |
| `src/KeelHashing.sol` | EIP-712 typehashes and struct hashes for the shared structs. Kept apart so `KeelTypes.sol` stays untouched. |
| `src/PDRGate.sol` | The Keel Personal gate (T1.6). Sole member of the AGENT role; verifies the signed PDR and executes `USDC.transfer` through the Roles Modifier. |
| `src/IRoles.sol` | Minimal interface of Zodiac Roles v2 `execTransactionWithRole`. |
| `script/DeployPDRGate.s.sol` | Deploys `PDRGate` against an existing Safe and Roles Modifier and writes `deployments/<chainId>.json`. |
| `test/PDRGate.t.sol` | One revert per typed error, compromised-signer cases, panic button, Safe-only configuration and two fuzz properties. |
| `test/Eip712Vectors.t.sol` | Writes the EIP-712 test vector (`out-vectors/eip712.json`) that the TypeScript side must reproduce byte for byte. |
| `test/DeployPDRGate.t.sol` | Runs the deployment script end to end against mocks. |
| `test/mocks/Mocks.sol` | USDC, Safe and Roles mocks. Roles errors mirror the real contract (`NoMembership`, `ConditionViolation`). |
| `deployments/<chainId>.json` | Addresses consumed by the other areas (written by the deployment script). |

## How PDRGate executes a payment

`execute(intent, decision, sigPolicy, sigCosigner)` is permissionless: authority comes from the signatures, the relayer only pays gas. In order:

1. Reverts if paused (`GateIsPaused`).
2. Recomputes the EIP-712 struct hash of the intent and compares it with `decision.intentHash` (`IntentMismatch`).
3. Builds the calldata itself with `abi.encodeCall(IERC20.transfer, (recipient, amount))` and compares its hash with `decision.calldataHash` (`CalldataMismatch`). Only tiers 1 and 3 reach the gate (`InvalidTier`).
4. Verifies the policy signature over the EIP-712 digest of the decision (`BadPolicySignature`). EOA and ERC-1271 signers are accepted.
5. Checks the policy version (`StalePolicy`).
6. Checks the decision expiry and the intent deadline (`Expired`).
7. Consumes the nonce (`NonceUsed`).
8. Marks the invoice as paid; on-chain idempotency (`InvoiceAlreadyPaid`).
9. For tier 3, requires the cosigner signature over the same digest (`MissingCosignature`).
10. Executes through the Roles Modifier with the AGENT role. Roles re-checks target, selector, recipient allowlist and monthly allowance.
11. Emits `PaymentExecuted(intentHash, pdrHash, tier, invoiceKey)`, where `pdrHash` is the EIP-712 digest of the decision.

Configuration (`setPolicySigner`, `setPolicyHash`, `setCosigner`, `pause`, `unpause`) is callable only by the Safe (`OnlySafe`). In production these calls must arrive through the Delay Modifier.

## Invariants of the escrow

1. The total paid out never exceeds the amount deposited.
2. No funds leave to an address other than the importer or the payout address of the order.
3. A final state never moves funds again.
4. One bill of lading never settles two orders.

## Interface notes for the other areas

* **`invoiceKey` encoding.** It is `keccak256(abi.encode(rut, folio, period))` over normalized strings, as implemented by Area 3 in `ingest/src/invoiceKey.ts` (RUT without dots or hyphen with a verified check digit, folio without leading zeros, period `YYYYMM`). Packed concatenation would collide: RUT 7.612.345-4 with invoice 448213 and RUT 76.123.454-4 with invoice 48213 produce identical bytes (`InvoiceKeyCollisionTest`).
* **`AgentRoleRevoked` is not emitted by the gate.** Revoking the agent role happens in the Roles Modifier, not in `PDRGate`. Monitors and the activity log must listen to the Roles Modifier `AssignRoles(module, roleKeys, memberOf)` event with `module == PDRGate` and `memberOf == false`.
* **Events and errors added by the gate** (proposed, beyond the frozen list): errors `InvalidTier` and `OnlySafe`; events `GateUnpaused`, `PolicySignerSet`, `PolicyHashSet` and `CosignerSet`.
* **Roles errors are codes, not text.** A rejected call reverts with `NoMembership()` or `ConditionViolation(Status status, bytes32 info)`. Area 1 provides the `status` to message table with a real hash for each case.

## Known limitations

* Current tests use a Roles mock. Fork tests against the real Zodiac Roles v2 on Base Sepolia are pending (T1.7).
* The gate cannot tell whether a configuration call came through the Delay Modifier or directly from the Safe owner. Closing that gap is the ConfigGuard (T1.5); until then it is declared as a known risk.

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
