# On-chain evidence, Area 1 (task 6, phases 1 and 3)

Maintained by **Area 1**. It sends the transactions that show each registry, gate and escrow check of Keel Trade working on a real deployment, and writes one JSON file per case. The output format is a starting point: **Area 5 may adapt it** to the final layout of `evidence/` (everything that shapes a file is in `record.ts`, in `toJson` and `fileName`).

## How a reverting case is sent

1. `eth_call` with the same sender, calldata and gas captures the exact error. If the call **succeeds**, or reverts with a different error, nothing is sent and the case fails.
2. The transaction is sent anyway with a **fixed gas** (`--revert-gas`, default 1,000,000), so no node refuses it at estimation.
3. The receipt must have status 0, with gas used below the limit (so it is not an out of gas revert).
4. The mined error is decoded against the ABIs of FundingGate, TradeEscrow and Roles, from `debug_traceTransaction` when the node has it, otherwise from an `eth_call` replay on the parent block (`actual.source` says which one).
5. The file keeps the hash, block, expected error, simulated and mined error (name and decoded arguments) and `cast run <hash> --rpc-url …` to reproduce it.

Addresses come from `.env` (`OWNER_ADDRESS`, `DEMO_EXPORTER_ADDRESS`, `DEMO_PAYOUT_ADDRESS`, `DEMO_CARRIER_ADDRESS`, `DEMO_ARBITER_ADDRESS`, `DEMO_ATTACKER_ADDRESS`, and `POLICY_SIGNER_ADDRESS` as the document verifier). Each script loads only the keys it uses, the first time it needs one: `OWNER`, `DEMO_EXPORTER`, `DEMO_CARRIER` and `DEMO_ATTACKER`, each checked against its `*_ADDRESS`. `DEMO_PAYOUT` and `DEMO_ARBITER` never sign or send, so their keys are never read. Keys are never printed or written. The reproduce command names `$BASE_SEPOLIA_RPC_URL` instead of the URL, which may carry an API key. Any RPC that is not a local anvil node needs `--live`.

The Safe may have several owners (ours and Area 4's): the script signs with `OWNER_PRIVATE_KEY` only, and aborts unless `OWNER_ADDRESS` is an owner and the threshold is 1.

## Cases

| Case | What | Expected |
|---|---|---|
| 1.1 | Safe queues the supplier (DEMO_EXPORTER, DEMO_PAYOUT), carrier, arbiter and verifier (POLICY_SIGNER_ADDRESS), plus the app's supplier (APP_EXPORTER_ADDRESS, APP_PAYOUT_ADDRESS) when both are set, and waits `configDelay` | active |
| 1.2 | Safe queues (DEMO_EXPORTER, DEMO_ATTACKER) and vetoes it | vetoed |
| 1.3 | Deposit for an order paying the vetoed DEMO_ATTACKER | `UnknownSupplier` |
| 1.4 | Deposit for an order with an unregistered carrier | `UntrustedParty` |
| 1.5 | Deposit for an order whose importer is not the Safe | `NotOwnOrder` |
| 1.6 | Deposit whose PDR approved another calldata | `CalldataMismatch` |
| 1.7 | Deposit with a PDR not signed by the policy signer | `BadPolicySignature` |
| 1.8 | Any account calls Roles `execTransactionWithRole` | `NotAuthorized(sender)` |
| 1.9 | Safe pauses the gate, a deposit is tried, Safe unpauses | `GateIsPaused` |
| 3.1 | A real deposit relayed again from another account | `OrderNotOpen` |
| 3.2 | The exporter disputes before the shipment | `InvalidState` |
| 3.3 | Carrier attestation after `shipmentDeadline + refundGrace` | `DeadlinePassed` |
| 3.4 | The same bill of lading on a second order | `BillOfLadingAlreadyUsed` |

Step 1.1 is idempotent: it reads the registry first, skips every entry already pending or active with the same data (its file lists the earlier `ChangeQueued` transaction, found by block timestamp so that a 10-block `eth_getLogs` limit is enough) and stops if an entry is registered with other data. Account nonces come from viem's `nonceManager` and the Safe nonce is kept by the script; reads, simulations and gas estimates run at the block of the last receipt or later, because a load-balanced RPC can still answer from an older block right after a receipt.

Orders 1.3 to 1.7 and 1.9 are opened for real in the escrow (the Safe signs through ERC-1271 with the owner key, DEMO_EXPORTER signs too) and stay OPEN. The PDRs of phase 1 are signed by DEMO_ATTACKER: the real policy key is never used.

## Usage

Run from the repo root after `forge build` in `contracts/`. Each order totals `--amount` (default 1 USDC = `1000000`) with a `--advance-bps` advance (default 1000 = 10 %).

```sh
TSX=node_modules/.bin/tsx; CLI=redteam/src/evidence/area1/cli.ts
$TSX $CLI phase1 [--steps 1.3,1.4] [--out DIR]     # default: every step, in order
$TSX $CLI app-setup --policy-hash <hash>           # Delay policy + app carrier and arbiter (below)
$TSX $CLI open-order [--deadline-seconds 600]       # an order for a real deposit of phase 3
$TSX $CLI phase3 repeat-deposit   --tx <deposit tx hash>
$TSX $CLI phase3 exporter-dispute --order <orderId>
$TSX $CLI phase3 duplicate-bl     --order <orderId A> --order-b <orderId B> [--bl <number>]
$TSX $CLI phase3 late-attestation --order <orderId>  # waits deadline + grace, showing the time left
$TSX $CLI summary --out DIR                          # table of every file in DIR
```

`app-setup` runs in one process, so the owner's nonces never collide: it checks that the Delay has nothing pending, queues `FundingGate.setPolicyHash` on it (as `SetTradePolicy.s.sol`), queues `APP_CARRIER_ADDRESS` and `APP_ARBITER_ADDRESS` with the idempotent 1.1 (after checking that neither is the Safe, a Safe owner, the cosigner, the guardian, the policy signer or `RELAYER_ADDRESS`, nor has code), waits for the cooldown, runs `executeNextTx`, waits for `configDelay` and reads back the policy hash and both roles. It writes `1.0-…` (policy) and `1.1-…app carrier and arbiter`.

Common options: `--rpc-url` (default `$BASE_SEPOLIA_RPC_URL`), `--deployments` (default `contracts/deployments/<chainId>.json`), `--out` (default a new temporary directory), `--live` (required for a real chain).

Phase 3 needs three real deposits of 1 USDC each, made by the real flow on orders from `open-order`:

* **Order A** (open with `--deadline-seconds 3600` or more): 3.1 with its deposit hash, then 3.2, then 3.4 as order A. 3.2 must run before 3.4, because 3.4 ships A for real.
* **Order B** (same deadline): order B of 3.4.
* **Order C** (default 10 minute deadline): 3.3. The real flow must deposit it within those 10 minutes, or `fund` reverts with `DeadlinePassed`. The script then waits until `shipmentDeadline + refundGrace` has passed.

If order A is already SHIPPED, pass the BL number it was shipped with in `--bl`. Use orders dedicated to the evidence that no other flow attests: 3.2 only reverts while the order is ADVANCE_PAID, so a shipment landing between the simulation and inclusion would turn the exporter's dispute into a real one.

Before each phase the script checks the deployment wiring, that no demo key is the gate's policy signer (the phase 1 PDRs signed by DEMO_ATTACKER must fail at the signature whatever else changes), the Safe owner and threshold, that the gate is not paused, the Safe's USDC balance, gas on the sending accounts, and the registries or order states the case needs. If any of them fails it aborts with a message.

## Fork test

`fork/run.sh [out-dir]` starts `anvil --fork-url` of Base Sepolia, deploys with `DeployTrade` (send and `record`, with the broadcast, the cache and the deployments file outside `contracts/`), with the guardian and the two Safe owners of the demo (`OWNER_ADDRESS` and `SECOND_OWNER_ADDRESS`, threshold 1; a throwaway address if the second is not in `.env`), then runs `fork/prepare.ts base` (gas and USDC for the Safe), phase 1, `fork/prepare.ts deposits` (a throwaway policy key set by the Safe, 3 real deposits) and phase 3. Only there is time moved with `evm_increaseTime`, before 3.3. `fork/prepare.ts` refuses any node that is not anvil.

Declared risks: the fork signs with the real demo and deployer keys under chain id 84532 (DeployTrade only targets that chain), so its signed transactions would be valid on Base Sepolia; they stay inside the local anvil (listening on 127.0.0.1), which `run.sh` stops on exit. `--rpc-url` and `anvil --fork-url` put the RPC URL in the process list of the local machine.
