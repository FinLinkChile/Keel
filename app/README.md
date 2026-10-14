# app (Area 4)

The Keel app: importer and exporter profiles, purchase order creation and signing, readable diff of the order, escrow status, dispute, cosigner view, activity log and tier panel.

React Native with Expo and TypeScript. It runs on Android, iOS and the web from the same code. `App.tsx` is a placeholder shell. Each party signs from their own wallet (WalletConnect or a browser wallet on the web build): no owner key on any server.

The flow the app serves is in [docs/flujo_clave.md](../docs/flujo_clave.md). The payout address shown to the user always comes from the signed order and the party registry, never from a document.

```sh
npm install            # from the repository root
npm run start -w app   # Expo dev server, scan the QR with Expo Go
npm run web -w app     # run in the browser
npm run typecheck -w app
```

Add Expo packages with `npx expo install <package>` from this folder, so the versions match the SDK. `AGENTS.md` has the Expo conventions for AI coding agents.

The shared interfaces are imported from `@keel/schemas`. Metro resolves the workspace package from source, so there is nothing to build first.

## Tasks

Tasks are described in [docs/keel_division_trabajo.md](../docs/keel_division_trabajo.md). Tasks that keep their number changed scope with the change of direction of October 13.

| Task | Issue |
|---|---|
| T4.1 Supplier onboarding with out of band verification | #26 |
| T4.2 Readable diff of the order before signing | #27 |
| T4.4 Signature with no key on the server | #29 |
| T4.5 Cosigner view | #30 |
| T4.7 Activity log and tier panel | #32 |
| T4.8 English copy and demo design | #33 |
| T4.9 Importer and exporter profiles, order flow | to be created |
| T4.10 Dispute and cancellation | to be created |
