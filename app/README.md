# app (Area 4)

The Keel app: onboarding, beneficiary book, readable diff of changes, cosigner view, activity log and tier panel.

React Native with Expo and TypeScript. It runs on Android, iOS and the web from the same code. `App.tsx` is a placeholder shell. The owner signs from their own wallet (WalletConnect or a browser wallet on the web build): no owner key on any server.

```sh
npm install            # from the repository root
npm run start -w app   # Expo dev server, scan the QR with Expo Go
npm run web -w app     # run in the browser
npm run typecheck -w app
```

Add Expo packages with `npx expo install <package>` from this folder, so the versions match the SDK. `AGENTS.md` has the Expo conventions for AI coding agents.

The shared interfaces are imported from `@keel/schemas`. Metro resolves the workspace package from source, so there is nothing to build first.

## Tasks

| Task | Issue |
|---|---|
| T4.1 Onboarding with out of band verification | #26 |
| T4.2 Readable diff for beneficiary changes | #27 |
| T4.4 Owner signature with no key on the server | #29 |
| T4.5 Cosigner view | #30 |
| T4.7 Activity log and tier panel | #32 |
| T4.8 English copy and demo design | #33 |
