#!/bin/bash
# Real multi-connection concurrency proof on a throwaway clone of the dev database.
# Usage: scripts/concurrency_test.sh [source-db]
SRC=${1:-orsquare_dev}
CLONE=orsquare_conc
cd "$(dirname "$0")/.."
PSQL() { MSYS_NO_PATHCONV=1 docker exec odoo18-spike-db psql -U odoo -d postgres -v ON_ERROR_STOP=1 -c "$1" >/dev/null; }
PSQL "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$SRC','$CLONE') AND pid <> pg_backend_pid()"
PSQL "DROP DATABASE IF EXISTS $CLONE"
PSQL "CREATE DATABASE $CLONE TEMPLATE $SRC"
MSYS_NO_PATHCONV=1 docker exec -i odoo18-spike-web odoo shell -c /etc/odoo/odoo.conf -d "$CLONE" --http-port=8099 --no-http \
  < scripts/concurrency_test.py 2>&1 | grep -E "^(PASS|FAIL|ALL|CONC|      \(|Traceback|  File|[A-Za-z]*Error)" | head -80
PSQL "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$CLONE' AND pid <> pg_backend_pid()"
PSQL "DROP DATABASE IF EXISTS $CLONE"
