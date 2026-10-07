#!/bin/bash
# Run any odoo-shell script on a throwaway clone of a database (so seeds/benchmarks never touch real data).
# Usage: scripts/run_on_clone.sh <script.py> [source-db] [grep-pattern]
SCRIPT=$1; SRC=${2:-orsquare_dev}; PATTERN=${3:-.}
CLONE=orsquare_scratch
cd "$(dirname "$0")/.."
PSQL() { MSYS_NO_PATHCONV=1 docker exec odoo18-spike-db psql -U odoo -d postgres -v ON_ERROR_STOP=1 -c "$1" >/dev/null; }
PSQL "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$SRC','$CLONE') AND pid <> pg_backend_pid()"
PSQL "DROP DATABASE IF EXISTS $CLONE"
PSQL "CREATE DATABASE $CLONE TEMPLATE $SRC"
MSYS_NO_PATHCONV=1 docker exec -i odoo18-spike-web odoo shell -c /etc/odoo/odoo.conf -d "$CLONE" --http-port=8099 --no-http \
  < "$SCRIPT" 2>&1 | grep -E "$PATTERN" | cut -c1-220 | head -${LINES_MAX:-80}
PSQL "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$CLONE' AND pid <> pg_backend_pid()"
PSQL "DROP DATABASE IF EXISTS $CLONE"
