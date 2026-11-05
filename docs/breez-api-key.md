# Breez SDK API key

The passkey web wallet passes `WALLET_BREEZ_API_KEY` to the Breez SDK as `apiKey`. That wallet's deployment
environment supplies the value when it has one. The passkey web wallet starts when the value is absent.

Each public host has its own key. The keys are not in git.

| Environment | Public host         |
| ----------- | ------------------- |
| Production  | `app.dfx.swiss`     |
| Develop     | `dev.app.dfx.swiss` |
| Staging     | `stg.app.dfx.swiss` |

Do not copy a key from another environment. Do not commit a value.
