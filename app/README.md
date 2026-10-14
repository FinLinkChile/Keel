# app (Area 4)

The Keel app, with two account types:

* Personal (Keel Personal): onboarding, beneficiary book, readable diff of beneficiary changes, activity log and tier panel.
* Company (Keel Trade): importer and exporter profiles, purchase order creation and signing, readable diff of the order, escrow status and dispute.

The cosigner view is shared by both.

React Native with Expo and TypeScript. It runs on Android, iOS and the web from the same code. `App.tsx` is a placeholder shell. Each party signs from their own wallet (WalletConnect or a browser wallet on the web build): no owner key on any server.

The Keel Trade flow is in [docs/flujo_clave.md](../docs/flujo_clave.md), and the Keel Personal one in section 4 of [docs/KEEL_SOLUCION_ALCANCE.md](../docs/KEEL_SOLUCION_ALCANCE.md). The payout address shown to the user never comes from a document: it comes from the signed order and the party registry, or from the table of registered beneficiaries.

```sh
npm install            # from the repository root
npm run start -w app   # Expo dev server, scan the QR with Expo Go
npm run web -w app     # run in the browser
npm run typecheck -w app
```

Add Expo packages with `npx expo install <package>` from this folder, so the versions match the SDK. `AGENTS.md` has the Expo conventions for AI coding agents.

The shared interfaces are imported from `@keel/schemas`. Metro resolves the workspace package from source, so there is nothing to build first.

## Tasks

Tasks are described in [docs/keel_division_trabajo.md](../docs/keel_division_trabajo.md). A task that exists in both modes keeps one number: its base text is Keel Personal and Keel Trade adds to it.

| Task | Issue |
|---|---|
| T4.1 Onboarding with out of band verification (beneficiary, supplier) | #26 |
| T4.2 Readable diff before signing (beneficiary change, order) | #27 |
| T4.4 Signature with no key on the server | #29 |
| T4.5 Cosigner view | #30 |
| T4.7 Activity log and tier panel | #32 |
| T4.8 English copy and demo design | #33 |
| T4.9 Account type, importer and exporter profiles, order flow (added by Trade) | to be created |
| T4.10 Dispute and cancellation (added by Trade) | to be created |
