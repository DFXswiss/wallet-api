#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is empty" >&2
  exit 1
fi

session_secret=${WALLET_SESSION_SECRET:-}
if [ "${#session_secret}" -lt 32 ]; then
  echo "WALLET_SESSION_SECRET is empty or shorter than 32 characters" >&2
  exit 1
fi

case ${ENVIRONMENT:-} in
  prd|stg|dev|loc) ;;
  *)
    echo "ENVIRONMENT must be exactly one of prd, stg, dev, loc" >&2
    exit 1
    ;;
esac

node ./node_modules/typeorm/cli.js migration:run -d dist/data-source.js
exec node dist/main.js
