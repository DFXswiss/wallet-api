# Contributing

Changes to Wallet API come through a draft pull request against `develop`. Pull requests must not target `main` or
`staging` directly.

## Where the logic lives

Wallet logic, data preparation, and calculations belong in this repository. DFXswiss/app stays a thin client. A pull
request that leaves that work in the app is incomplete, including work this service does not expose yet. The rule is
`README.md`, section "Where the logic lives".

For Bitcoin and EVM, balances, prices, fees, input selection, destination checks, history, the unsigned payment, and
submission belong in this service. The device holds the seed, derives an address from that seed, signs the WebAuthn
challenge, and signs the unsigned payment. It returns the signed payment.

Any Spark step that needs `WALLET_BREEZ_API_KEY` or the seed stays on the device. This service may store the Spark
address and return destination checks and prices. Lightning-address and LNURL lookup belong in this service. A pull
request that moves the seed or the private key into this service is incomplete.

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
