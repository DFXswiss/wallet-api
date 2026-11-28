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
wallet addresses, diagnostics, and prepared Bitcoin payments (unsigned PSBT, inputs with their wallet addresses,
outputs, amount, fee, txid) in a Postgres database owned by this service. A wallet session issued by this API is a
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
- `ESPLORA_BASE_URLS`: a JSON object mapping a blockchain id to an HTTPS origin. A `BitcoinRegtest` key stops boot in
  every environment; regtest has its own variable below.
- `ESPLORA_REGTEST_URL`: the Esplora upstream for the blockchain id `BitcoinRegtest`, and its only source. The value
  is an `http:` or `https:` origin with no path other than `/`, no credentials, no query, and no fragment, for example
  `http://regtest-esplora.example:3000`. It is accepted on `stg`, `dev`, and `loc`; an invalid value stops boot. On
  `prd`, setting it stops boot, and `BitcoinRegtest` always answers 404 `EsploraNotConfigured`. While it is unset,
  `BitcoinRegtest` answers 404 `EsploraNotConfigured`, and a `BitcoinRegtest` key in `ESPLORA_BASE_URLS` is never
  used. `BitcoinRegtest` belongs to the `bitcoin` family like every Esplora blockchain id: while `bitcoin` is off it
  answers 403 `WalletFamilyDisabled` before any of these checks. Path, query, and transaction checks are the same as
  for `ESPLORA_BASE_URLS`.
- `EVM_RPC_URLS`: a JSON object mapping a chain id string to an HTTPS JSON-RPC URL.
- `WALLET_PRICE_URL`: an HTTPS price source URL. Prices return 503 while it is unset.
- `WALLET_PRICE_HOSTS`: comma-separated hosts permitted for `WALLET_PRICE_URL`.

The HTTP server listens on `PORT` (default `3000`). Every public route has the path prefix `/v1/wallet`.

### Wallet families

Wallet API decides which chain families the passkey wallet offers. The app shows exactly what
`GET /v1/wallet/config` returns. The route needs no session:

```json
{ "families": { "bitcoin": true, "spark": false, "evm": false } }
```

Every family is always present, as `true` (offered) or `false` (not offered). There is no other field.

The switches are not environment variables. Each environment has its own file in this repository,
`src/config/environments/<env>.ts`, selected by `ENVIRONMENT`. The process reads the file at boot. Every file must
set `bitcoin`, `spark`, and `evm` to `true` or `false`. A missing switch, a value other than `true` or `false`, an
unknown family, or a missing or unknown `ENVIRONMENT` stops boot before the migrations run. Changing a switch needs a
reviewed pull request and a deploy. For the families, the deployment configuration only sets `ENVIRONMENT`.

| Environment (`ENVIRONMENT`) | `bitcoin` | `spark` | `evm`   |
| --------------------------- | --------- | ------- | ------- |
| `prd`                       | `true`    | `false` | `false` |
| `stg`                       | `true`    | `false` | `false` |
| `dev`                       | `true`    | `false` | `false` |
| `loc`                       | `true`    | `false` | `false` |

While a family is off, its routes answer 403 with code `WalletFamilyDisabled`. The refusal comes before validation,
lookups, database access, and outbound requests. `PUT /v1/wallet/addresses` checks the session first: without a valid
session it answers 401. After the session check, the refusal comes before body validation, lookups, database access,
and outbound requests. The `/v1/wallet/bitcoin/:blockchain/*` routes check the family first: while `bitcoin` is off
they answer 403 even without a session or with an invalid one, and no session lookup happens. A JSON body that cannot
be parsed is answered with 400, and one larger than 1 MB with 413 `PayloadTooLarge`, by the body parser before any of
these checks.
The routes per family:

- `bitcoin`: `GET /v1/wallet/esplora/:blockchain/*`, `POST /v1/wallet/esplora/:blockchain/tx`,
  `PUT /v1/wallet/addresses` with chain `bitcoin`, and every `/v1/wallet/bitcoin/:blockchain/*` route (`account`,
  `fees`, `prepare`, `submit`). The Esplora and Bitcoin routes belong to this family for every blockchain id (`Bitcoin`,
  `BitcoinTestnet4`, `BitcoinRegtest`, and any other id); the family check comes before the upstream lookup, so an id
  without an upstream answers 403 rather than 404 while the family is off.
- `spark`: `PUT /v1/wallet/addresses` with chain `spark`, `GET /v1/wallet/lnurl`, and
  `GET /v1/wallet/lightning-address/:address`. Lightning is paid only through Spark in this wallet.
- `evm`: `POST /v1/wallet/evm/:chainId/rpc`, `GET /v1/wallet/ens/address`, `GET /v1/wallet/ens/name`, and
  `PUT /v1/wallet/addresses` with chain `ethereum`.

`GET /v1/wallet/chains` and `GET /v1/wallet/addresses` leave out the entries of a family that is off. Stored addresses
stay in the database and are listed again when their family is switched on. `GET /v1/wallet/prices` and
`GET /v1/wallet/lists/:id` do not belong to a family.

Passkey relying party settings are strict:

RP ids and origin hosts are compared exactly, in lower case and without a trailing dot.

- `prd` requires `app.dfx.swiss` and `https://app.dfx.swiss`.
- `stg` requires `stg.app.dfx.swiss` and `https://stg.app.dfx.swiss`.
- `dev` requires an RP id that is neither `app.dfx.swiss`, nor a host under it, nor a parent domain of it
  (`dfx.swiss`, `swiss`) and an HTTPS origin whose hostname is that RP id. It additionally accepts exactly
  `dev.app.dfx.swiss` with `https://dev.app.dfx.swiss`.
- `loc` requires an RP id that is neither `app.dfx.swiss`, nor a host under it, nor a parent domain of it
  (`dfx.swiss`, `swiss`) and an origin whose hostname is that RP id. HTTPS or HTTP may be used.
  `dev.app.dfx.swiss` is not accepted.

Session tokens are HMAC-signed JWTs with issuer `wallet-api`, audience `wallet`, and a 12-hour lifetime. Revoking a
credential locks that row before the clock is read. The same timestamp invalidates tokens issued in that second or
earlier. A successful finish deletes the challenge. Storing a challenge deletes expired rows. Registration and
authentication share a cap of 1000 live challenges. Revocation has its own cap of 1000. Either cap refuses the insert
with 429 `ChallengeRateLimited`, and anonymous ceremonies cannot fill the revocation cap. Diagnostics accept a missing session. Rows older than 24 hours
are deleted, and a further row is refused with 429 `DiagnosticRateLimited` once 500 remain. An EVM JSON-RPC batch of
more than 16 calls is refused before any upstream request.

## Browser access (CORS)

Browsers on the app origin call this API through the DFX API host. CORS allows only the environment's app origin (on
`loc`, also `PASSKEY_ORIGIN`) and no other:

- `prd`: `https://app.dfx.swiss`
- `stg`: `https://stg.app.dfx.swiss`
- `dev`: `https://dev.app.dfx.swiss`
- `loc`: `http://localhost:3000` and `PASSKEY_ORIGIN` when it is a bare origin

Allowed methods are `GET`, `POST`, and `PUT`; allowed request headers are `Authorization` and `Content-Type`.
Credentials are not allowed: the wallet session travels in the `Authorization` header. Preflight answers are cached for
600 seconds. A request from another origin receives no `Access-Control-Allow-Origin` header.

CORS stays in this service. The DFX API host (DFXswiss/front-api) forwards `/v1/wallet/*` to Wallet API and passes the
upstream response headers through unchanged; it adds no CORS headers of its own for `/v1/wallet/*`. The CORS headers
the browser sees on `/v1/wallet/*`, including the `/v1/wallet/bitcoin/*` routes and their preflights, are therefore the
ones set here. Moving CORS to the forwarding host would need a change in both repositories at the same time.

## Bitcoin on-chain

This service prepares Bitcoin payments; the device signs them. The device derives its BIP-84 addresses (P2WPKH), sends
them with each request, signs the returned PSBT with the key of each input's address, and returns the signed payment.
Seeds and private keys never reach this service.

Every route is `/v1/wallet/bitcoin/:blockchain/...` and belongs to the `bitcoin` wallet family: while it is off, after the
body parser (400 unparseable JSON, 413 body over 1 MB), every route answers 403 `WalletFamilyDisabled` before the session check, validation, the blockchain lookup, database access,
and any Esplora request. While it is on, every route requires a wallet session (`Authorization: Bearer <token>`).
`:blockchain` is `Bitcoin`, `BitcoinTestnet4`, or `BitcoinRegtest`, and only when its Esplora upstream is configured:
`ESPLORA_BASE_URLS` for the first two, `ESPLORA_REGTEST_URL` for regtest, which is never available on `prd`. Any other
or unconfigured id answers 404 `EsploraNotConfigured`, like the Esplora proxy. Wallet addresses must be P2WPKH on that
network (`bc1q`, `tb1q`, `bcrt1q`); bech32 addresses are accepted in all lower or all upper case and are returned in
lower case. All amounts are integer sats.

Errors have the shape `{ statusCode, code, message }`. For the codes listed below, `message` repeats `code`. The
request body is checked in two steps. First, the JSON types: a missing required field, or a field of the wrong JSON
type (for example a number for `amount`, a string for `historyLimit`, or a non-string entry in `addresses`), answers
400 `BadRequest`, and `message` is then an array of validation messages. An optional field may be left out, but JSON
`null` is a wrong JSON type on every field, optional ones included: `null` never means "not given" or "use the
default" and also answers 400 `BadRequest`. Second, the service checks count, format, and
range and answers the documented codes below, also over HTTP. Unknown fields are dropped. A request body larger than
1 MB is refused before both steps with 413 `PayloadTooLarge`; every size limit documented below fits within 1 MB.

### `POST account`

Request: `{ "addresses": string[1..50], "historyLimit"?: 1..100 }` (default 50). Duplicate addresses (also the same
bech32 address in upper and lower case) are merged. Response 200:

- `balance`: `{ confirmed, unconfirmed, total }`. `unconfirmed` is negative while a spend is in the mempool.
- `addresses[]`: `{ address, confirmed, unconfirmed, total, txCount, used }`. Gap-limit discovery stays on the device:
  it derives the next batch until it sees 20 consecutive addresses with `used: false`.
- `utxos[]`: `{ txid, vout, value, address, confirmed, height, confirmations }`, unconfirmed first. A zero-value UTXO is
  listed with `value: 0`; it is valid on chain, anyone can send one to a known address, and prepare never spends it.
- `history[]`: `{ txid, confirmed, height, time, confirmations, netAmount, fee, direction }`, unconfirmed first, then
  newest first. `netAmount` is what the given addresses received minus what they spent, so an outgoing payment
  includes its fee. `direction` is `incoming`, `outgoing`, or `self`. `fee` is the whole transaction fee.
- `tipHeight`, `historyLimit`, and `historyComplete`. History is bounded, not paginated: it holds each address's first
  Esplora page (25 confirmed plus the unconfirmed transactions), merged and cut at `historyLimit`. `historyComplete` is
  `false` when older transactions exist.

Errors:

- 400 `BadRequest`: `addresses` missing or not an array of strings; `historyLimit` not a number (including `null`).
- 400 `AddressInvalid`: no address, more than 50, or one that is not P2WPKH on the network (including a wrong length).
- 400 `HistoryLimitInvalid`: `historyLimit` not an integer from 1 to 100 (for example `0`, `101`, `1.5`).
- 404 `EsploraNotConfigured`: unknown or unconfigured `:blockchain`.
- 502 `OutboundRequestFailed`: Esplora failed or answered something malformed.

### `GET fees`

Response 200: `{ blockchain, source, unit: "sat/vB", rates: { fast, normal, slow } }`. Rates are integers taken from
Esplora `fee-estimates` for the targets 1, 6, and 144 blocks (the next target above, or the largest present), rounded
up after subtracting 0.05 sat/vB (`ceil(rate - 0.05)`, no further rounding: 1.05 gives 1, 1.0501 gives 2), at least 1,
and with `fast >= normal >= slow`.

When Esplora answers with no estimate (regtest usually answers `{}`), `BitcoinTestnet4` and `BitcoinRegtest` use the
fallback `{ fast: 3, normal: 2, slow: 1 }` with `source: "fallback"`, outside `prd` only. `Bitcoin` has no fallback in any
environment and nothing has one on `prd`: those answer 503 `FeeEstimatesUnavailable`.

Errors: 404 `EsploraNotConfigured` (unknown or unconfigured `:blockchain`); 502 `OutboundRequestFailed`; 503
`FeeEstimatesUnavailable`.

### `POST prepare`

Request:

- `addresses`: the wallet addresses whose UTXOs may be spent, 1 to 50; duplicates are merged.
- `changeAddress`: a P2WPKH address on the network.
- `destination`: a P2PKH, P2SH, P2WPKH, P2WSH, or P2TR address on the network.
- `amount`: integer sats as a decimal string, or `"max"`.
- Exactly one of `feeRate` (`fast`, `normal`, `slow`) and `feeRateSatPerVb` (integer 1 to 1000).
- `rbf` (default `true`): BIP-125 sequence `0xfffffffd`; `false` uses `0xffffffff`.
- `includeUnconfirmed` (default `false`): also spend unconfirmed UTXOs.
- `allowOwnDestination` (default `false`): allow a destination that is one of `addresses` or `changeAddress`.

Selection is deterministic largest-first. UTXOs worth no more than the cost of spending them (68 vB times the fee rate)
are left out and counted in `uneconomicalUtxos`; zero-value UTXOs always are. Change is created only when it is at least 294 sats; a smaller
remainder goes to the fee and is reported in `changeAddedToFee`. The change output's position is random. `"max"` spends
every spendable UTXO into one output without change. A transaction has at most 200 inputs. `vsize` is an upper
estimate for the signed transaction.

Response 201: `{ prepareId, expiresAt, blockchain, psbt, txid, destination, amount, fee, feeRate, change,
changeAddress, changeAddedToFee, vsize, rbf, totalInput, uneconomicalUtxos, inputs[], outputs[] }`. `psbt` is an
unsigned BIP-174 PSBT in base64, version 2, lock time 0; every input carries `witnessUtxo` and no BIP-32 derivation.
`inputs[]` are `{ txid, vout, value, address }` in transaction order; the device signs input `i` with the key of
`inputs[i].address`. `outputs[]` are `{ address, value, kind }` in transaction order, `kind` being `destination` or
`change`. The prepared payment can be submitted for 10 minutes.

Errors:

- 400 `BadRequest`: a required field missing or of the wrong JSON type (`addresses` not an array of strings;
  `changeAddress`, `destination`, or `amount` not a string; `feeRate` not a string; `feeRateSatPerVb` not a number;
  `rbf`, `includeUnconfirmed`, or `allowOwnDestination` not a boolean). An optional field sent as `null` is of the
  wrong JSON type too.
- 400 `AddressInvalid`: `addresses` empty, more than 50, or with an entry that is not P2WPKH on the network; a
  `changeAddress` that is not P2WPKH on the network.
- 400 `DestinationInvalid`: `destination` is no address of a supported type (including a wrong length).
- 400 `DestinationWrongNetwork`: `destination` is valid on another Bitcoin network.
- 400 `AmountInvalid`: `amount` is neither `"max"` nor an integer from 1 to 21 million BTC in sats without leading
  zeros (for example `"0"`, `"01"`, `"1.5"`).
- 400 `FeeRateChoiceInvalid`: none or both of `feeRate` and `feeRateSatPerVb`, a `feeRate` other than `fast`,
  `normal`, `slow` (for example `"instant"`), or a `feeRateSatPerVb` that is not an integer from 1 to 1000 (for
  example `0`, `1001`, `1.5`).
- 404 `EsploraNotConfigured`: unknown or unconfigured `:blockchain`.
- 422 `DestinationIsOwnAddress`, `InsufficientFunds`, `AmountBelowDust` (below the destination's dust threshold: 546
  P2PKH, 540 P2SH, 294 P2WPKH, 330 P2WSH and P2TR), `FeeExceedsAmount`, `TooManyInputs`.
- 429 `PrepareRateLimited`: 20 unexpired, unsubmitted prepared payments per wallet.
- 502 `OutboundRequestFailed`: Esplora failed or answered something malformed.
- 503 `FeeEstimatesUnavailable`: `feeRate` was chosen and no estimate is available (see `GET fees`).

### `POST submit`

Request: `{ "prepareId": uuid }` and exactly one of `transactionHex` (the signed transaction) and `psbt` (the signed
PSBT in base64, finalized or not; this service finalizes it, which needs no key).

The signed transaction must have the prepared `txid`. P2WPKH signatures sit in the witness, which the txid does not
cover, so the txid is equal exactly when the transaction spends the prepared inputs to the prepared outputs with the
prepared sequence, version, and lock time. Because the txid says nothing about signatures, every input must also be a
complete P2WPKH spend of the prepared input: an empty script signature and a witness of exactly two items, a non-empty
signature of at most 73 bytes and a compressed public key whose P2WPKH script is the script of the prepared input's
`address`. This is checked right after the txid, before the repeat and expiry checks. The transaction is then broadcast
through Esplora. The broadcast counts as done only when Esplora answers 2xx with a body that is exactly the prepared
`txid` (surrounding whitespace ignored). Any other 2xx body (empty, HTML, JSON, another txid) answers 502
`OutboundRequestFailed`, and the prepared payment stays submittable.

Response 200: `{ txid, prepareId, alreadySubmitted }`. Repeating a submit of the same signed transaction answers the
same `txid` with `alreadySubmitted: true` and does not broadcast again; so does a first submit when the node already
knows the transaction. A repeat with the unsigned transaction or an incomplete witness answers 400
`TransactionNotSigned`, never `alreadySubmitted: true`.

Prepared payments are deleted once they expired more than 24 hours ago. The delete runs in every prepare, in every
submit before the lookup, and once an hour in each running instance, so a payment is gone at the latest about 25 hours
after it expired even without further requests. After that, its `prepareId` answers 404 `PrepareNotFound`.

Errors:

- 400 `BadRequest`: `prepareId` missing or not a string; `transactionHex` or `psbt` present but not a string
  (including `null`).
- 400 `SubmitPayloadInvalid`: none or both of `transactionHex` and `psbt`.
- 400 `TransactionInvalid`: the hex or PSBT cannot be decoded, is too large (`transactionHex` over 800,000
  characters, `psbt` over 1,000,000 characters, or a transaction over 400,000 bytes), or is no valid transaction.
- 400 `TransactionNotSigned`: an input is no complete P2WPKH spend of the prepared input (no witness, a witness not of
  two items, an empty or longer than 73-byte signature, a public key that is not compressed or not the key of the
  prepared input's address), also on a repeat after a successful submit; or the PSBT cannot be finalized.
- 404 `EsploraNotConfigured`: unknown or unconfigured `:blockchain`.
- 404 `PrepareNotFound`: `prepareId` is not a UUID, unknown, deleted, or another wallet's or another blockchain's id.
- 410 `PrepareExpired`.
- 413 `PayloadTooLarge`: request body larger than 1 MB.
- 422 `TransactionMismatch`: the transaction's txid differs from the prepared one.
- 422 `BroadcastRejected`: the node refused the transaction; the prepared payment stays submittable until it expires.
- 502 `OutboundRequestFailed`: Esplora failed, or answered 2xx without exactly the prepared txid; the prepared payment
  stays submittable until it expires.

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
- `staging` is the pre-production line. The `staging-from-main.yml` workflow moves it, and nothing else does: every
  new `main` head is fast-forwarded onto `staging`, and that run then starts the `stg` build even when `staging`
  already points at that head. Pull requests never target `staging`.
- `main` is the release line. A push to `main` creates `develop` when it is absent.

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
branch publishes the tag `stg`, and `main` publishes the tag `latest`. The `staging-from-main.yml` workflow keeps
`staging` at every new `main` head as a fast-forward and starts the `stg` build for it, including when `staging`
already points at the head. Every run pushes the commit SHA tag; each run points the channel tag at the image of the
branch's current head once that image exists;
a manual run publishes only from the channel's own branch. The image is built for linux/arm64 only.
The container runs the application's own configuration check before the migrations, then listens. A
failed check or migration does not listen.

## Breez SDK key

This service does not read `WALLET_BREEZ_API_KEY`. Wallet API configuration stays the required and optional
lists above.
