---
type: Entrega
title: "Area 2 input for the security self-assessment report"
description: "English text from Area 2 (policy engine, PDR, keys) for the security self-assessment report (T5.3): permission tiers, key custody, what a stolen policy key can do, declared risks and the tests that back each claim."
tags: [informe-de-seguridad, t5-3, area-2, niveles, llaves, riesgos, entregable-05]
modo: trade
status: draft
generated: { by: claude-code/claude-sonnet-5-5, at: 2026-10-16T12:00:00Z }
---

This is the Area 2 contribution to deliverable 05 (security self-assessment report, task T5.3). It is an input for Area 5, not the final report. Every claim says for whom it holds, where it is enforced and which test shows it. Where a part is not built or not merged yet, the text says so.

Scope: Keel Trade on Base Sepolia (chainId 84532), the engine in `engine/`, the shared schemas in `schemas/`, and the points where the engine meets the contracts of Area 1. Status labels used below: **merged** (in `dev`), **open PR** (written and tested, not merged: #51 verifier, #54 agent service, #60 monitor), **pending** (not built).

# 1. Separation of powers

"The AI reads, the engine decides, people authorize, the contract executes."

| Power | Who holds it | Where it is enforced | What shows it |
| --- | --- | --- | --- |
| Read documents | One quarantined LLM extractor with no tools and an output schema without free text, checked against a deterministic parser | Ingest (Area 3). The engine parses the extraction again with the same schema before using it | `engine/src/documents.test.ts` ("rejects an extraction outside the schema instead of evaluating it") |
| Decide | The policy engine: pure functions, no network, no LLM, no implicit clock | `evaluateFunding` and `evaluateDocuments` in `engine/src/funding.ts` and `engine/src/documents.ts` | `funding.test.ts` ("is deterministic"), `documents.test.ts`, `corpus.test.ts` |
| Authorize | The owners of each Safe (sign the purchase order, change configuration), the cosigner (tier 3, veto, pause), the carrier (shipment attestation) | EIP-712 signatures checked on chain by `TradeEscrow` and `FundingGate`. The owner key is never loaded by any server component | `contracts/test/TradeEscrow.t.sol`, `contracts/test/FundingGate.t.sol`, `engine/src/keys.test.ts` |
| Execute | `FundingGate` for the deposit, `TradeEscrow` for everything after it | On chain. The gate builds the calldata itself and runs it through Zodiac Roles. The escrow pays only the importer or the `payoutAddress` signed in the order | `test_goal_*` and `testFuzz_fundingImpliesActiveSupplier` (FundingGate), `testFuzz_payoutsEqualTotal` (TradeEscrow) |

The engine does not hold funds or keys that move funds. The relayer only pays gas. Neither the relayer nor the LLM is a member of any Roles role, so without a valid Policy Decision Record (PDR) the gate and the escrow revert (`test_relayerKey_cannotCallRolesDirectly` for the Personal gate; the Trade gate is permissionless for the caller and takes its authority from the signatures).

# 2. Permission tiers 0 to 4 in Keel Trade

The tier of a deposit is the highest tier that any of the seven deposit rules forces (`evaluateFunding`). The tier assignment of actions is a team proposal (open decision 9), implemented as follows.

| Tier | Meaning | What the agent may do | Where it is enforced | Status |
| --- | --- | --- | --- | --- |
| 0, read | No authority | Read the proforma, order, bill of lading and invoice; show a legible diff; propose a structured order that people sign. Warn and suggest a dispute when documents do not match | Absence of capability: a reader holds no key and no Roles membership; chat has no tools that move funds | The reader holds no key by construction. A test that the reading component has no permission in Roles is **pending** (Area 1 and Area 5) |
| 1, autonomous | Deposit of a fully signed order inside every limit | Fund an order that both parties signed, whose supplier pair (exporter and payout address) and whose carrier, arbiter and document verifier are active in the gate registries, within the agent role allowance. Present the carrier attestation, release the balance with a conforming `DocumentDecision`, trigger the refund after the deadline | Engine rules (tier 1 only if all seven pass). `FundingGate.execute` checks the PDR, the stored order and the registries, then calls Roles with the agent role. Roles limits target, selector, spender and allowance per period. The escrow state machine limits what each later step can do | Engine and gate **merged**. Agent loop that sends these steps is an **open PR** (#54). Allowance is read from a mock Roles in the demo (see risks) |
| 2, with wait | New supplier or new third party | Propose it. The agent cannot approve it: the Safe queues the supplier pair or the carrier, arbiter or verifier in the gate registry, it counts only after `configDelay` (120 seconds in the demo, 48 hours documented for production, minimum 60 seconds by `MIN_CONFIG_DELAY`), and the Safe or the cosigner can veto each queued change individually. Removing is immediate | Engine rule `known-supplier` returns tier 2 for an unknown pair. `FundingGate` rejects the deposit with `UnknownSupplier` or `UntrustedParty` until the entry is active. The engine never signs a tier 2 decision (`buildPolicyDecision` throws) | Gate **merged** (`test_revert_UnknownSupplier_oneSecondBeforeActivation`, `test_veto_byCosignerKeepsSupplierUnknown`). Other configuration (policy signer, cosigner, policy version, Roles membership and allowances) is meant to go through the Zodiac Delay, which is **pending** (T1.4 and T1.5, see risks) |
| 3, cosign | Deposit over the remaining allowance, or an amount far from the usual one with that supplier | The agent prepares and signs the PDR. It cannot execute alone: the cosigner must sign the same EIP-712 digest. With it the gate uses a second Roles role with a larger allowance | Engine rules `period-allowance` and `amount-in-range` return tier 3. `FundingGate` requires the cosigner signature (`MissingCosignature`) and selects `cosignedRoleKey`. The cosignature selects the role only: it never skips the registries | Gate **merged** (`test_tier3_fundsOverAgentCapWithCosignedRole`, `test_revert_MissingCosignature_*`, `test_goal_stolenPolicyAndCosignerKeys_tier3StillReverts`). How the cosignature returns to the agent is open decision 16: today the agent stops at "awaiting approval" with the signed PDR in the evidence folder |
| 4, forbidden | Blocked | Nothing. The engine produces no intent and no PDR: a blocked deposit has nothing to sign. Cases: order not found or not open, hash differs from the signed order, order of another Safe, a party not registered, non-independent roles, token without allowance, deadline already passed | Engine rules return tier 4 and `buildPolicyDecision` rejects tiers 0, 2 and 4, so these never reach the chain. Changing the `payoutAddress`, carrier or arbiter of a signed order has no path at all: it needs a new order signed by both parties, with a new nonce | `funding.test.ts` ("a blocked deposit carries no intent"), `pdr.test.ts` ("tier 0, 2 and 4 never become a PDR"), `test_revert_BadImporterSignature_payoutSwappedAfterSigning` |

Always human acts: signing the purchase order, raising a dispute, cancelling (needs both parties' signatures), and resolving a dispute (the arbiter). The cosigner can approve or stop but cannot start a payment or withdraw to itself. The arbiter can only split between the importer and the signed payout address (`BadResolution`, `BadArbiterSignature` tests).

# 3. Key custody

Common rules, enforced in `engine/src/keys.ts` and proven in `engine/src/keys.test.ts`:

* The owner key never lives on a server. No environment variable exists for it.
* One key per role: relayer, policy signer and automatic cosigner are different keys (`assertSeparateKeys`).
* The policy key signs `PolicyDecision` and `DocumentDecision` and nothing else: not transactions, not plain messages, not a purchase order or a token permit (`loadPolicySigner`). The signer address can be checked against the one registered on chain before any PDR is issued.
* No key enters the repository. In the demo they live in an untracked `.env`. KMS or HSM is the documented production path, not built.

"Bound" says what limits the damage and where. "Merged" refers to the proof, not to the whole feature.

| Key | Holder | What it can do | What a thief gets | What bounds it, and where | Test | Rotation |
| --- | --- | --- | --- | --- | --- | --- |
| Relayer | Agent server | Pay gas, submit transactions | The gas balance. No authority: it is not a Roles member | Gate and escrow require a valid PDR or signature. `FundingGate` is permissionless for the caller on purpose | `test_relayerKey_cannotCallRolesDirectly` (PDRGate); `fundingGate` tests above | Replace and refill gas, no Delay |
| Policy signer | Agent host (separate process from the relayer is the intent) | Sign PDRs | See section 4 | Roles (target, selector, spender, allowance); gate registries; `payoutAddress` fixed in the signed order; period allowance | `test_goal_stolenPolicyKey_newPayoutReverts`, `testFuzz_fundingImpliesActiveSupplier`, `keys.test.ts` | Safe registers a new one (`setPolicySigner`); PDRs of the old key stop validating at once |
| Document verifier | In the prototype, the same key as the policy signer | Sign the `DocumentDecision` for orders that name it | Mark non-conforming documents as conforming, in orders that name this key | The balance also needs the carrier attestation (another key) and the dispute window; the escrow pays only the signed `payoutAddress`; the engine refuses to sign if its key is not the order's verifier | `documents.test.ts` ("only the document verifier of the order signs"); escrow `test_revert_BadDocumentDecision_*` | New orders name another verifier. An open order keeps the verifier it names |
| Cosigner | A trusted person, from their own wallet | Cosign tier 3, veto queued changes, pause the gate | Cosign tier 3 operations that already carry a valid policy signature; veto every queued change and pause the gate (delays, cannot add) | Gate also requires the policy signature and the registries; cosigner has no `queue*`, `unpause` or config rights | `test_revert_BadPolicySignature_cosignerCannotActAsPolicy`, `test_revert_OnlySafe_cosignerCan*`, `test_emergencyPause_byCosigner` | Safe calls `setCosigner` |
| Monitor pauser (proposal) | The monitor, on a server | Only pause the gate | Pause deposits until the Safe resumes. Cannot approve, cosign or move funds | A dedicated pause-only role in the gate, requested from Area 1. It must not be the cosigner key | `engine/src/monitor/monitor.test.ts` (uses the cosigner key as a stand-in) | Safe replaces it |
| Owners of the Safe | Company representatives, own wallets | Sign orders, change configuration | New orders and configuration changes, as far as the Safe threshold allows | Safe threshold (2 of 3 in production, 1 of 1 in the demo). Gate configuration only from the Safe | `test_revert_OnlySafe_configSetters` | Safe recovery or owner change |
| Carrier (test key) | A team test key in the prototype | Sign shipment attestations for orders that name it | False attestations for those orders | Only for orders that fix it as `carrier`; one bill of lading per carrier (`BillOfLadingAlreadyUsed`); dispute window; the carrier is distinct from the verifier and the arbiter | `test_revert_BadCarrierSignature_*`, `test_revert_BillOfLadingAlreadyUsed_sameCarrierTwoOrders` | New orders name another carrier |
| Arbiter (test key) | A team test key in the prototype | Split the remaining balance of a disputed order | An unfair split between importer and payout address, not a payment to itself | Escrow: the split must sum exactly to the remaining balance, recipients fixed by the order | `test_revert_BadResolution_*`, `test_revert_BadArbiterSignature_*` | New orders name another arbiter |
| Bot token | Bot server (Area 4) | Send messages to registered chats | Fake messages to the owner | Templates with typed fields; the bot signs nothing; its buttons open the app, where the wallet signs | Area 4 (pending in the sources read) | Regenerate at the provider |
| LLM API key | Ingest server (Area 3) | Call the extractor model | Cost and abuse. No access to funds | Provider spending limit; the admin API never shows or accepts keys; the extractor has no tools | `ingest/src/server.test.ts`, `ingest/src/settings.test.ts` | Regenerate and restart |

If the policy key leaks: the cosigner pauses the gate, the Safe registers a new key and resumes, and the evidence folder is reviewed for every PDR signed since the leak. This runbook is written, not rehearsed in a test.

# 4. A stolen policy key: what it can and cannot do

Holds for: a Keel Trade importer Safe whose gate, Roles and registries are configured as in the demo. Enforced in: `FundingGate`, Zodiac Roles and `TradeEscrow`.

**Cannot do** (each backed by a test in `contracts/test/FundingGate.t.sol` or `TradeEscrow.t.sol`):

* Fund an order whose supplier pair (exporter and payout address) is not active in the Safe registry, or whose carrier, arbiter or document verifier is not active with that role (`test_goal_stolenPolicyKey_newPayoutReverts`, `test_goal_exporterControlledCarrierReverts`, `testFuzz_fundingImpliesActiveSupplier`). Adding to the registry is possible only from the Safe and counts only after `configDelay`, with an individual veto.
* Fund an order that both parties did not sign, or a different version of one: the gate compares the order stored in the escrow, and the escrow verified both signatures when it opened the order (`test_revert_OrderMismatch_orderHashOfAnotherVersion`).
* Change who gets paid. The payout address is in the signed order. The escrow pays only the importer or that address (`testFuzz_payoutsEqualTotal`, `test_revert_BadImporterSignature_payoutSwappedAfterSigning`).
* Exceed the Roles allowance of the agent role. Over the cap the gate selects the cosigned role, which needs the cosigner signature (`test_revert_AllowanceExceeded_tier1OverAgentCap`, `test_revert_MissingCosignature_*`).
* Cosign its own tier 3 decision (`test_revert_MissingCosignature_policyKeyAsCosigner`).
* Sign anything other than a PDR through the engine custody code (`keys.test.ts`). This protects the key as loaded by Keel's code; it does not bind someone who holds the raw key.
* Release the balance on its own. The balance also needs the carrier attestation (a different key) and, unless the importer approves, the dispute window.
* With the cosigner key as well (tier 3): still no new payout address and no unapproved third party (`test_goal_stolenPolicyAndCosignerKeys_tier3StillReverts`).

**Can do:**

* Deposit, within the allowance, orders that both parties already signed with an approved supplier and approved third parties. This moves funds from the company into the escrow, where the order's own rules govern them.
* If the same key is the document verifier of an order (the prototype default), declare non-conforming documents conforming in those orders. The carrier attestation and the dispute window still apply, and the importer can raise a dispute while the order is shipped. The payout still goes only to the signed address, so the gain is a premature or wrongful release to the legitimate payout address, not a diversion.
* Sign a `DocumentDecision` with an old `policyHash`: the escrow has no policy registry, so only `expiresAt` limits an old decision (declared risk).

**How the monitor (T2.8) reacts.** The monitor reads the events of `FundingGate` and `TradeEscrow`. A `FundingExecuted` whose PDR hash has no file in the engine evidence folder, or a `BalanceReleased` authorized by a digest that is neither an engine PDR nor the importer's own approval, is an incident. It tries to pause the gate with a pause-only key.

Status, stated plainly: the monitor is an **open PR** (#60, draft). The pause-only role in `FundingGate` does not exist yet (it was requested from Area 1). Today `emergencyPause` is accepted only from the Safe and the cosigner, so the monitor simulates the pause, sees it revert (`OnlySafeOrCosigner`), spends no gas, and records the incident as an alert for the human cosigner, who pauses from the app. The monitor test uses the cosigner key as a stand-in for the future role to show that the pause stops the next deposit (`GateIsPaused`). The monitor detects after the first operation: it limits the damage of a stolen key and does not prevent the first misuse. Revoking the agent role in Roles (T1.3) is not built.

# 5. Known risks of Area 2, declared

| # | Risk | Who it affects | What limits it today | Status |
| --- | --- | --- | --- | --- |
| 1 | The policy signer and the document verifier are the same key on the agent host in the prototype. One stolen key or one compromised host can sign deposits and mark documents as conforming | Importers whose orders name Keel's key as `documentVerifier` | Section 4 limits. Production path: a verifier with its own key and process, named in each order | Declared, not fixed |
| 2 | The policy signer runs on a server. It is a hot key | All Trade importers | Roles allowance, registries, monitor alert. KMS or HSM is the production path | Declared, not built |
| 3 | The escrow does not check `policyHash` of a `DocumentDecision` and has no policy registry. An old decision is limited only by `expiresAt` and by being bound to the order, the accepted attestation and the documents | Orders whose verifier key signed an older decision | `expiresAt`; payout fixed to the signed address. The gate does check `policyHash` (`StalePolicy`) for deposits | Accepted by Area 1, declared |
| 4 | `keel verify` recovers only EOA signatures. A Safe or other ERC-1271 signer shows as a mismatch rather than being validated | Anyone replaying a decision signed by a contract wallet | The escrow itself accepts ERC-1271 verifiers on chain (`test_releaseBalance_verifierIsSafe1271`). The prototype signers are EOAs | Declared, not built |
| 5 | The monitor reads the engine evidence folder from the same host. If it runs elsewhere the folder must be synchronized or it reports false incidents; if the host is compromised the attacker can also write evidence files | The monitor's detection | Chain events are the source of truth for what happened; the folder only says what the engine issued | Declared. Open PR #60 |
| 6 | Without the pause-only role the monitor only alerts | Reaction time to a stolen policy key | Human cosigner pauses from the app | Pending (Area 1) |
| 7 | In the demo the agent role allowance is read from a mock Roles. The real Zodiac Roles reader is pending (T1.7) | The tier 1 and tier 3 boundary in the demo | The gate still executes through Roles; mock and fork tests cover the call shape | Pending |
| 8 | The Zodiac Delay and ConfigGuard (T1.4, T1.5) are not built. A Safe owner can change the policy signer, cosigner, policy version or Roles configuration without a wait. The registry additions of the gate are the exception: they wait on chain | Importers during the prototype | Safe threshold; registry waits are enforced by the gate | Pending |
| 9 | Open decision 13: how the jury verifies transactions on a closed network. `keel verify` can anchor to Base Sepolia, but the jury needs access to the chain or an explorer | Verification by the jury | The evidence file can be replayed offline, which gives EVIDENCE ONLY, never MATCH | Open |
| 10 | Open decision 16: how the tier 3 cosignature returns to the agent, and who submits if the PDR expires first | Tier 3 deposits | The agent stops at "awaiting approval" with the signed PDR saved. The demo act uses tier 1 | Open |
| 11 | The engine evidence proves what the system recorded, not that nothing escaped it. Inputs to a decision (extractions, registry data) are only as true as ingest and the party registry | All | `inputsHash` binds the decision to its inputs; the carrier signature and the contract bound a wrong extraction | Declared |
| 12 | The extractor can return a false value inside a valid schema. The engine compares it against the signed order and the carrier attestation | Document decisions | 14 document rules; carrier signature; parser agreement in ingest | Declared |

# 6. Evidence

Tests run in this repository with `npm test` (vitest) and `forge test` (contracts). On 2026-10-16 the files `corpus.test.ts`, `funding.test.ts`, `documents.test.ts` and `keys.test.ts` were run together on this branch and passed (107 tests). The contract and open-PR tests are cited by name from the sources and were not re-run for this text.

| Claim | File | Status |
| --- | --- | --- |
| Deposit rules and tiers, determinism | `engine/src/funding.test.ts` | Merged |
| Document rules, fail closed without signed terms, verifier-only signing | `engine/src/documents.test.ts` | Merged |
| PDR signing equals the contract digest; tampering, replay, expiry, wrong chain, wrong signer rejected; tiers 0, 2, 4 never issued | `engine/src/pdr.test.ts` | Merged |
| Key custody: policy key signs only PDRs, one key per role, errors never show a value | `engine/src/keys.test.ts` | Merged |
| Engine and `FundingGate` agree on errors, events and calldata hash | `engine/src/fundingGate.test.ts` | Merged |
| Gate: registries with delay and veto, tier 3, stolen-key goals | `contracts/test/FundingGate.t.sol` | Merged (#57) |
| Escrow state machine and payout invariants | `contracts/test/TradeEscrow.t.sol` | Merged |
| Corpus through the engine | `engine/src/corpus.test.ts` | Merged (#55) |
| Anchored verifier | `engine/src/verify.test.ts` | Open PR (#51) |
| Agent loop against the compiled escrow and gate | `engine/src/agent/agent.test.ts` | Open PR (#54) |
| Monitor | `engine/src/monitor/monitor.test.ts` | Open PR (#60) |

**Corpus result.** The Trade document corpus has 54 documents. 43 of them reach the engine (ingest outcome "ready"): 24 legitimate and 19 adversarial. All 43 match their labels, with exactly the labelled decision and reason codes. The 24 legitimate documents are released. Of the 19 adversarial documents, 16 are held with the exact reason (hidden text 8, account change mentioned 2, invoice amount mismatch 2, on board date mismatch 2, order number mismatch 1, on board date after the deadline 1, port mismatch 1; reason codes can overlap in one document). The other 3 adversarial documents (a silently printed unregistered bank account, a bill of lading claiming a digital signature and asking to release payment, an injection with a wallet in the consignee field) are labelled "release" on purpose: they change no field the engine compares and no payout address, because the payout address comes only from the signed order. The remaining 11 adversarial documents are stopped before the engine (held, duplicate, rejected or quarantined by ingest). The corpus checks the engine rules on the extraction data of each document; it does not test the reading of PDFs by the LLM. This is a small hand-labelled set and not a general detection rate.

**`keel verify`** (open PR #51, also in #60). It takes a transaction hash or an evidence file, replays the same rules on the stored inputs and compares each hash. The transaction must come from a contract listed in `contracts/deployments/<chainId>.json`. The result is MATCH only when the chain names the signer: for a deposit, the policy signer the gate held at that block; for a balance release, the document verifier the order names. A consistent file without the chain gives EVIDENCE ONLY. The deployment file for Base Sepolia does not exist yet, so no real transaction has been verified.

# 7. What waits for the Base Sepolia deployment

No real transaction hash exists yet in this repository (`contracts/deployments/` holds no chain file). Claims here rest on tests against compiled contracts in a local chain. After the deployment, each claim with a transaction needs its hash from `keel verify` and the `EXECUTION_EVIDENCE.md` of Area 5.
