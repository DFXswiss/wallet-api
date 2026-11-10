#!/bin/sh
set -eu

node -e "require('./dist/config/environment').readWalletRuntimeConfig()"

node ./node_modules/typeorm/cli.js migration:run -d dist/data-source.js
exec node dist/main.js
