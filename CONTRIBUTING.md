# Contributing

Changes to Wallet API come through a draft pull request against `develop`. Pull requests must not target `main` or
`staging` directly.

## Where the logic lives

Wallet logic, data preparation, and calculations belong in this repository, except the device steps below.
DFXswiss/app stays a thin client. A pull request that leaves any of that work in the app is incomplete, including
work this service does not expose yet.
The rule is `README.md`, section "Where the logic lives".

The device holds the seed, derives an address from that seed, signs the WebAuthn challenge, and signs the unsigned
payment. It returns the signed payment. For Bitcoin and EVM, submitting that payment belongs in this service. A
Spark payment stays on the device, because this service does not read `WALLET_BREEZ_API_KEY` and the seed never
reaches this process. A pull request that moves the seed or the private key into this service is also incomplete.

The repository starts with `main` only. The workflow on `main` creates `develop` and `staging` when those refs are
absent. The pull request that introduces that workflow targets `main`. Later pull requests target `develop`.

A38 is the review and local CI standard. The job inventory is `.github/a38.json`. The branch scope is
`.github/pr-guard.json`. Because `main` is the default branch, the guard enforces `main` and `develop`.

The standard is pinned at
<https://github.com/DFXswiss/agent/blob/dbd5aeac2565a6414456c4640a762df1ac046cf9/docs/a38.md>.
The guard guide is pinned at
<https://github.com/DFXswiss/agent/blob/dbd5aeac2565a6414456c4640a762df1ac046cf9/docs/a38-guard.md>.

Before a pull request is marked ready for review:

- `npm run format:check` passes.
- `npm run lint` passes.
- `npm test` passes.
- `npm run build` passes.

Commits must be signed.

Keep changes scoped to this service. Wallet API owns its database and its session tokens; it does not implement customer
identity verification, purchasing, selling, or account linking for another service.
