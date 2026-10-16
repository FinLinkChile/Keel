---
type: Entrega
title: "Area 2 input for the technical document: core algorithm"
description: "English text from Area 2 (policy engine, PDR, FundingGate and escrow flow) for the core algorithm section of the technical document (T5.6): the flow, the deposit and document rules, determinism, the agent loop and the monitor."
tags: [documento-tecnico, t5-6, area-2, motor, pdr, algoritmo, entregable-01]
modo: trade
status: draft
generated: { by: claude-code/claude-sonnet-5-5, at: 2026-10-16T12:00:00Z }
---

This is the Area 2 contribution to deliverable 01 (technical document, task T5.6). It is an input for Area 5, not the final document. Hash and field names are the ones in `schemas/src/index.ts`.

# 1. Overview

Keel Trade lets an AI agent operate a company wallet to pay an international purchase order without giving the AI authority over the money. The agent reads documents, but a deterministic policy engine decides, people authorize with EIP-712 signatures over structured data, and two contracts execute: the `FundingGate` deposits the order into a `TradeEscrow`, and the escrow releases an advance when it is funded, the balance when the shipment is proven, and a refund if the deadline plus a grace period passes. The engine takes the signed purchase order, the state read from the chain and the extracted document fields as inputs, applies versioned rules, and outputs a tier plus a signed Policy Decision Record (PDR) that binds the exact calldata the gate will run. The payout address is never read from a document: it comes only from the order that both parties signed.

# 2. The flow

| Step | What happens | Who | Where |
| --- | --- | --- | --- |
| 1. Order | Importer and exporter sign the same `PurchaseOrder` (EIP-712). It fixes the payout address, token, total, advance, shipment deadline, incoterm, carrier, arbiter, document verifier, `termsHash` and `requiredDocsHash`. `TradeEscrow.open` checks both signatures and the role separation, and stores the order in state OPEN | The two parties | Contract |
| 2. Deposit decision | `evaluateFunding` applies seven rules and returns a tier and, unless blocked, a `FundIntent` (orderId, orderHash, escrow, token, amount, deadline, nonce) | Engine | `engine/src/funding.ts` |
| 3. PDR | The engine builds a `PolicyDecision` and signs it (EIP-712). Fields: `intentHash`, `calldataHash`, `policyHash`, `inputsHash`, `tier`, `expiresAt`. `calldataHash = keccak256(abi.encode(approveData, fundData))`, the exact `approve` and `fund` calls the gate will build. Only tiers 1 and 3 become a PDR | Engine | `engine/src/pdr.ts` |
| 4. Deposit | `FundingGate.execute` checks, in order: pause, intent binding, escrow and token, the stored order (OPEN, hash, token, amount, importer is this Safe), the trust registries (supplier pair, carrier, arbiter, verifier active), the calldata hash, the PDR (tier, signature, `policyHash`, expiry, nonce, cosignature for tier 3). Then it runs exact `approve` and `fund` through Zodiac Roles. `fund` pulls the total and pays the advance to the signed payout address in the same transaction (state ADVANCE_PAID) | Anyone submits; authority is in the signatures | Contract |
| 5. Shipment | The carrier named in the order signs a `ShipmentAttestation` (orderId, blNumberHash, onBoardDate, portOfLoading, docsHash). `submitShipment` checks the signature, the on-board date window (not before funding, not after the deadline, not in the future), and that the bill of lading was not used before for that carrier. State SHIPPED | Carrier, anyone submits | Contract |
| 6. Document decision | `evaluateDocuments` compares the extracted transport document and invoice with the signed order, its signed terms and the carrier attestation, using 14 rules. If all pass it returns a `DocumentDecision` (orderId, attestationHash, docsHash, policyHash, inputsHash, expiresAt) | Engine | `engine/src/documents.ts` |
| 7. Balance | The order's document verifier signs the `DocumentDecision`. After the dispute window, `releaseBalance` verifies it against the stored attestation and documents and pays the remaining balance only to the signed `payoutAddress`. The importer can instead approve earlier (`approveBalance`). Either party can raise a dispute from SHIPPED; the arbiter then splits the balance between the importer and the payout address | Verifier or importer | Contract |
| 8. Refund | If no shipment was accepted, `refundAfterDeadline` returns the unreleased balance to the importer once `now > shipmentDeadline + refundGrace`. The same comparison closes `submitShipment`, so exactly one of the two is possible at any second | Anyone | Contract |

The document extraction happens before step 6. A quarantined LLM with no tools reads the PDFs and may only return JSON with a fixed schema (no free text). A deterministic parser extracts the same fields; if they disagree the operation is held. The engine parses the extraction again with the schema and treats it as untrusted data: a wrong value has to survive the comparison with the signed order and the carrier's signature to matter.

# 3. Deposit rules (`evaluateFunding`)

Each rule returns the minimum tier it forces. The final tier is the highest of the seven. Tier 4 returns no intent. Reason codes are fixed identifiers, never free text. Defaults live in `DEFAULT_FUNDING_POLICY` and are part of `policyHash`.

| Rule | Passes (tier 1) when | Escalates or blocks |
| --- | --- | --- |
| `order-signed` | The escrow holds the order in state OPEN and its stored hash equals the hash of the order being funded | Tier 4: `ORDER_NOT_FOUND`, `ORDER_NOT_OPEN`, `ORDER_HASH_MISMATCH` |
| `own-order` | The importer of the order is the Safe this engine works for | Tier 4: `NOT_THIS_SAFE` |
| `known-supplier` | The importer, exporter, carrier, arbiter and verifier are registered, and the pair (exporter, payout address) is a known supplier | Tier 2: `SUPPLIER_NEW` (a known exporter with a new payout address is a new supplier). Tier 4: `PARTY_NOT_REGISTERED` |
| `independent-roles` | Carrier, arbiter and verifier differ from the importer, exporter and payout address, and from each other (`keel-trade/2`, mirroring `TradeEscrow.open`) | Tier 4: `ROLE_NOT_INDEPENDENT` |
| `period-allowance` | The token has an allowance and the total fits the remaining allowance of the agent role | Tier 3: `OVER_ALLOWANCE`. Tier 4: `TOKEN_NOT_ALLOWED` |
| `amount-in-range` | No earlier orders with the supplier, or the total is within 25% (2500 bps) of their average | Tier 3: `AMOUNT_OUT_OF_RANGE` |
| `shipment-deadline` | The deadline is in the future (a deadline within 3 days passes with a `DEADLINE_SOON` notice) | Tier 4: `DEADLINE_PASSED` |

Tier 2 is handled by the gate registries and never becomes a PDR: the Safe queues the new supplier, it counts after `configDelay`, and the Safe or the cosigner can veto it. Tier 3 produces a PDR that also needs the cosigner signature over the same digest; the gate then uses the Roles role with the larger allowance.

# 4. Document rules (`evaluateDocuments`)

All rules run and all results are kept. The decision conforms only if every result is ok. There are 14 rule names and 15 checks, because `on-board-date` is checked twice (same day as the attestation, and not after the deadline). Reason codes are fixed identifiers.

| Rule | Passes when | Holds with |
| --- | --- | --- |
| `attestation-order` | The attestation is for this order | `ATTESTATION_OTHER_ORDER` |
| `document-number` | The hash of (carrier, document number read) equals the attested `blNumberHash` | `DOCUMENT_NUMBER_MISMATCH` |
| `on-board-date` (1) | The date read is the same UTC day as the attested date | `ON_BOARD_DATE_MISMATCH` |
| `on-board-date` (2) | The date read is not after the shipment deadline | `ON_BOARD_AFTER_DEADLINE` |
| `port-of-loading` | The port read equals the attested port | `PORT_MISMATCH` |
| `required-documents` | The document types read match the order's `requiredDocsHash` | `REQUIRED_DOCS_MISMATCH` |
| `docs-package` | The hash of the files the extractor read equals the attested `docsHash` | `DOCS_PACKAGE_MISMATCH` |
| `terms-signed` | The order terms supplied hash to the `termsHash` both parties signed | `TERMS_MISSING`, `TERMS_NOT_SIGNED` (every rule that needs the terms also fails, so the engine fails closed) |
| `order-number` | The invoice order number equals the signed terms | `ORDER_NUMBER_MISMATCH` |
| `invoice-amount` | Currency and amount equal the signed terms | `AMOUNT_MISMATCH` |
| `importer` | The tax ID on the invoice equals the one in the party registry (never one taken from a document) | `IMPORTER_MISMATCH` |
| `incoterm` | The invoice incoterm equals the order | `INCOTERM_MISMATCH` |
| `goods` | The HS code on the invoice is among the signed terms | `GOODS_MISMATCH` |
| `account-change` | The invoice does not mention an account change | `ACCOUNT_CHANGE_MENTIONED` (a fraud signal: hold and alert; it never changes the payout address) |
| `hidden-text` | Neither document has hidden text | `HIDDEN_TEXT` |

A hold does not move money. The balance stays in the escrow, the importer is notified with a templated message, and the importer can release by hand (`approveBalance`) or either party can open a dispute.

# 5. Determinism and reproducibility

* **Pure functions.** `evaluateFunding` and `evaluateDocuments` take everything as arguments: the order, a context read from the chain by the caller, the extractions, and `now` as a number. They call no network, no LLM and no clock. Tests: `funding.test.ts` ("is deterministic"), `documents.test.ts`.
* **Versioned rules.** `TRADE_RULES_VERSION` (`keel-trade/2`) and the tunable parameters go into `policyHash` with the hash of the versioned Roles configuration. The gate rejects a deposit whose PDR carries a different `policyHash` (`StalePolicy`). A test fails on any change to the rule files until the version is reviewed.
* **Inputs are hashed.** `inputsHash` is a hash of the canonical form (sorted keys, bigints as decimal strings) of everything the decision used: for a deposit, the order and the context; for documents, both extractions, the terms, the importer tax ID and the file hashes.
* **Evidence.** For every PDR the engine writes `evidence/pdr/<pdrHash>.json` with the decision, the signature, the rule results and the inputs to replay. On chain only the hash appears.
* **Replay.** `keel verify` re-runs the same rules on the stored inputs, compares the rules, tier, intent and hashes, recovers the signer, and checks the transaction against the contracts in `contracts/deployments/<chainId>.json`. The verdict is MATCH only when the chain names the signer, otherwise EVIDENCE ONLY or MISMATCH. It proves that the signed decision follows from those inputs under those rules and that the chain accepted that hash. It does not prove that the inputs were true.

# 6. The agent service loop and the monitor

**Agent service (T2.11).** Every tick, for each stored order whose importer is its Safe, the agent reads the escrow state and takes at most one step:

| Escrow state | Step |
| --- | --- |
| OPEN | Evaluate the deposit, sign the PDR, send through `FundingGate.execute`. A new supplier is reported as queued, tier 3 waits for the cosigner, tier 4 is reported as blocked |
| ADVANCE_PAID | After `shipmentDeadline + refundGrace`, call `refundAfterDeadline`. Otherwise present the carrier attestation, with two checks first (a margin before the refund window opens, and an on-board date not before the funding time). Remind the importer at 5, 3 and 1 days |
| SHIPPED | After the dispute window, run `evaluateDocuments`, sign the `DocumentDecision` and call `releaseBalance`. If it does not conform, hold and notify |
| Dispute or final states | Nothing. The arbiter or both parties move funds |

Every transaction is simulated before it is sent, so a call that would revert is held with the error name and costs no gas. The deposit nonce is `uint256(orderHash)`, so a retry after a crash cannot deposit twice. Known suppliers and trusted third parties are read from the gate, so the engine does not approve what the gate would reject. The chain is the source of truth: repeating a tick sends nothing twice. Notices to the bot are fixed codes and typed fields, never free text, and never block a payment.

**Monitor (T2.8).** It watches the gate and the escrow of the Safe. A deposit whose PDR is not in the engine evidence folder, or a balance release authorized by something other than an engine PDR or the importer's own approval, is treated as use outside the system. It tries to pause the gate with a pause-only key and alerts. It reports queued changes and configuration changes without acting. It cannot move funds, approve or resume.

# 7. Status

| Part | State on 2026-10-16 |
| --- | --- |
| Deposit rules, document rules, PDR issuance and signing, key custody, evidence files | Merged in `dev`, with tests. Note: `dev` carries the first version of the rule files; the `keel-trade/2` independent-roles rule, the funding `inputsHash` and `policy.ts` (the `policyHash`) arrive with the open PRs below |
| `FundingGate`, `TradeEscrow`, schemas, corpus through the engine (43 of 43 documents match their labels) | Merged (#57 gate, #55 corpus) |
| Anchored verifier `keel verify` | Open PR #51 |
| Agent service (loop, notices, gate connector) | Open PR #54 (draft) |
| Monitor | Open PR #60 (draft) |
| Pause-only role in the gate for the monitor | Not built (Area 1). Until then the monitor alerts the human cosigner |
| Real Zodiac Roles allowance reader (T1.7) | Not built. The demo reads a mock |
| Tier 3 cosignature return path (open decision 16) | Open. The agent stops at "awaiting approval" |
| Deployment on Base Sepolia and real transaction hashes | Waiting. `contracts/deployments/` has no chain file yet, so no real hash has been verified. Open decision 13 covers how the jury checks them |
