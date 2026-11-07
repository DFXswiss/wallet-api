# Wallet API

Wallet logic, data preparation, and calculations belong in this service.
[DFXswiss/app](https://github.com/DFXswiss/app) stays a thin client. Device steps and the Spark exception are named
below.

## Where the logic lives

The app shows what this API returns and sends the user's intent back. It does not talk to a chain node.

For Bitcoin and EVM, this service prepares balances, prices, fees, input selection, destination checks, history, and
the unsigned payment. A screen that needs one of those numbers receives it from this API. An endpoint that does not
exist yet is not a reason to put that work in the app.

The device holds the seed, derives an address from that seed, signs the WebAuthn challenge, and signs the unsigned
payment. It returns the signed payment. For Bitcoin and EVM, submitting that payment belongs in this service.

Spark is different. This service does not read `WALLET_BREEZ_API_KEY`, and the seed never reaches this process. Any
Spark step that needs that key or the seed stays on the device: preparing the payment, signing it, submitting it, and
the balance or history the Spark client reads. This service may store the Spark address and return destination checks
and prices. Lightning-address and LNURL lookup belong in this service. The payment after that lookup follows the
Bitcoin rule or the Spark rule above.

Wallet API is the public, non-custodial wallet HTTP API. It stores passkey credentials, one-time WebAuthn challenges,
wallet addresses, and diagnostics in a Postgres database owned by this service. A wallet session issued by this API is a
session for Wallet API only; it is not a customer session or a token for any other service.

The seed and the passkey private key never reach this process. Registration stores the COSE public key, the WebAuthn
credential id, the user handle, backup eligibility, the backup flag, the AAGUID, and the transports.

Buy, sell, KYC, swaps, banking, and related customer account flows are outside this repository. There are no claim,
link, or account-merge endpoints.

## Requirements

- Node.js `>=24.0.0 <25`
- Postgres 16

## Configuration

Required variables:

- `ENVIRONMENT`: one of `prd`, `stg`, `dev`, or `loc`. Missing or unknown values stop boot.
- `DATABASE_URL`: the connection URL for this service's Postgres database.
- `WALLET_SESSION_SECRET`: the HMAC secret for wallet session JWTs, at least 32 characters.

Optional variables:

- `PORT`: listening port, default `3000`.
- `PASSKEY_RP_ID` and `PASSKEY_ORIGIN`: the WebAuthn relying party pair. Passkey routes return 503 until it is valid.
- `ESPLORA_BASE_URLS`: a JSON object mapping a blockchain id to an HTTPS origin.
- `EVM_RPC_URLS`: a JSON object mapping a chain id string to an HTTPS JSON-RPC URL.
- `WALLET_PRICE_URL`: an HTTPS price source URL. Prices return 503 while it is unset.
- `WALLET_PRICE_HOSTS`: comma-separated hosts permitted for `WALLET_PRICE_URL`.

The HTTP server listens on `PORT` (default `3000`). Every public route has the path prefix `/v1/wallet`.

Passkey relying party settings are strict:

- `prd` requires `app.dfx.swiss` and `https://app.dfx.swiss`.
- `stg` requires `stg.app.dfx.swiss` and `https://stg.app.dfx.swiss`.
- `dev` and `loc` require a non-production RP id and an origin whose hostname is that RP id. HTTPS is required; `loc`
  may use HTTP.

Session tokens are HMAC-signed JWTs with issuer `wallet-api`, audience `wallet`, and a 12-hour lifetime. Revoking a
credential locks that row before the clock is read. The same timestamp invalidates tokens issued in that second or
earlier. A successful finish deletes the challenge. Storing a challenge deletes expired rows. Registration and
authentication share a cap of 1000 live challenges. Revocation has its own cap of 1000. Either cap refuses the insert
with 429 `ChallengeRateLimited`, and anonymous ceremonies cannot fill the revocation cap. Diagnostics accept a missing session. Rows older than 24 hours
are deleted, and a further row is refused with 429 `DiagnosticRateLimited` once 500 remain. An EVM JSON-RPC batch of
more than 16 calls is refused before any upstream request.

## Database

The schema belongs to this service. Run migrations before starting a deployed instance:

```sh
npm run typeorm -- migration:run
```

Postgres 16 can be started locally with:

```sh
docker compose up -d
```

The compose file contains only this service's Postgres instance, with database `wallet` and user `wallet`.

## Branch model

- `develop` is the integration branch. Pull requests target `develop` once that branch exists.
- `staging` is the pre-production line.
- `main` is the release line. A push to `main` creates `develop` and `staging` when they are absent.

## Development

```sh
npm ci
npm run format
npm run format:check
npm run lint
npm test
npm run build
npm start
```

Outbound HTTP clients sit behind injectable interfaces, so unit tests can run without opening sockets.

## Image

The container image is `dfxswiss/wallet-api`. `develop` publishes the tag `beta`, the `staging`
branch publishes the tag `stg`, and `main` publishes the tag `latest`. The process runs migrations,
then listens. A failed migration does not listen.

## Breez SDK key

This service does not read `WALLET_BREEZ_API_KEY`. Wallet API configuration stays the required and optional
lists above.
