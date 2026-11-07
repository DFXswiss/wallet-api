# Wallet API

Wallet logic, data preparation, and calculations belong in this service.
[DFXswiss/app](https://github.com/DFXswiss/app) stays a thin client. The only steps that stay on the device are named
below.

## Where the logic lives

This is where that work goes. The app shows what this API returns and sends the user's intent back.

Balances, prices, fees, input selection, destination checks, history, and the unsigned payment belong in this
service. The app does not do that work, and it does not talk to a chain node. A screen that needs a number receives
that number from this API. New wallet behaviour is added here, not in the app.

An endpoint that does not exist yet is not a reason to put the work in the app. The work still belongs in this
repository.

The device keeps only these wallet steps: it holds the seed, it holds the passkey private key, it derives an address
from that seed, and it applies the signature to the unsigned payment.

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

## Breez SDK key

This service does not read `WALLET_BREEZ_API_KEY`. Wallet API configuration stays the required and optional
lists above.
