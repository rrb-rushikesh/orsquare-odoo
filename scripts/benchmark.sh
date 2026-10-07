#!/bin/bash
# Backend benchmark on a throwaway clone of the dev database (never touches real data).
# Usage: scripts/benchmark.sh [source-db] [n_products]
SRC=${1:-orsquare_dev}
N=${2:-2000}
CLONE=orsquare_bench
cd "$(dirname "$0")/.."
PSQL() { MSYS_NO_PATHCONV=1 docker exec odoo18-spike-db psql -U odoo -d postgres -v ON_ERROR_STOP=1 -c "$1" >/dev/null; }
PSQL "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$SRC','$CLONE') AND pid <> pg_backend_pid()"
PSQL "DROP DATABASE IF EXISTS $CLONE"
PSQL "CREATE DATABASE $CLONE TEMPLATE $SRC"
( echo "N_PRODUCTS = $N"; cat scripts/benchmark.py ) | MSYS_NO_PATHCONV=1 docker exec -i odoo18-spike-web odoo shell \
  -c /etc/odoo/odoo.conf -d "$CLONE" --http-port=8099 --no-http 2>&1 | grep -E "^(RESULT|SEED|BENCH|Traceback|[A-Za-z]*Error)" | head -60
PSQL "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$CLONE' AND pid <> pg_backend_pid()"
PSQL "DROP DATABASE IF EXISTS $CLONE"
