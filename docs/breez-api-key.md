# Breez SDK API key

Wallet API does not read `WALLET_BREEZ_API_KEY`. The name is not one of the required or optional variables in
the README. This service's relying-party hosts are the public hosts below.

The passkey web wallet passes one value per host to the Breez SDK as `apiKey`. The values are not in git. The
passkey web wallet starts when the value is absent.

| Environment | Public host         |
| ----------- | ------------------- |
| Production  | `app.dfx.swiss`     |
| Develop     | `dev.app.dfx.swiss` |
| Staging     | `stg.app.dfx.swiss` |

Do not copy a key from another environment. Do not commit a value.
