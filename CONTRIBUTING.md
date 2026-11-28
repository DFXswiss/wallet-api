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

The repository starts with `main` only. The `ensure-branches.yml` workflow creates `develop` when that ref is absent.
The `staging-from-main.yml` workflow owns `staging`, and nothing else does: it creates `staging` when absent,
fast-forwards it to every new `main` head, and then starts the `stg` build, including when `staging` already points at
the head. Pull requests never target `staging`. The pull request that introduces that workflow targets `develop` and
becomes active when the bot release pull request reaches `main`. Later pull requests target `develop`.

The pull request from `develop` into `main` is opened only by the Auto Release PR workflow, as `github-actions[bot]`. A
person does not open it. On the next push to `develop`, the workflow closes a release pull request that a person opened
and opens its own. The check "Release PR from the bot" fails any other author.

A38 is the review and local CI standard. The job inventory is `.github/a38.json`. The branch scope is
`.github/pr-guard.json`. The guard enforces A38 on pull requests into `develop`. `main` is excluded: its only
pull request is the release pull request from `develop`, which carries changes that already passed A38 on `develop`.

The standard is pinned at
<https://github.com/DFXswiss/agent/blob/3528240c62d72e8f50f8ec5ddda0c4d213f0f04a/docs/a38.md>.
The guard guide is pinned at
<https://github.com/DFXswiss/agent/blob/3528240c62d72e8f50f8ec5ddda0c4d213f0f04a/docs/a38-guard.md>.

Before a pull request is marked ready for review:

- `npm run format:check` passes.
- `npm run lint` passes.
- `npm test` passes.
- `npm run build` passes.

Commits must be signed.

Keep changes scoped to this service. Wallet API owns its database and its session tokens; it does not implement customer
identity verification, purchasing, selling, or account linking for another service.
