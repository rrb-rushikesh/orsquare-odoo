#!/bin/bash
# Upgrade the orsquare module in the template and in EVERY shop database (one database per shop means
# schema upgrades are a loop). Each upgrade runs the module's migrations (idempotent bootstrap).
# Usage: scripts/upgrade_shops.sh [--tests] [--only db1,db2]
#   --tests   also run the module's automated tests in each database (slow; for staging)
#
# Run it as part of every deploy BEFORE traffic is routed to the new code. Failures are reported per
# database and do not stop the loop; the exit code is non-zero if any database failed.
cd "$(dirname "$0")/.."
mkdir -p scratch
TESTS=""; ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tests) TESTS="--test-enable --test-tags=/orsquare";;
    --only) shift; ONLY="$1";;
  esac
  shift
done
if [ -n "$ONLY" ]; then
  DBS=$(echo "$ONLY" | tr ',' ' ')
else
  DBS=$(MSYS_NO_PATHCONV=1 docker exec odoo18-spike-db psql -U odoo -d postgres -At \
        -c "SELECT datname FROM pg_database WHERE datname ~ '^orsquare_(shop|template)' ORDER BY 1")
fi
FAILED=0
for DB in $DBS; do
  START=$(date +%s)
  MSYS_NO_PATHCONV=1 docker exec odoo18-spike-web odoo -c /etc/odoo/odoo.conf -d "$DB" -u orsquare $TESTS \
      --stop-after-init --http-port=8099 --workers=0 > "scratch/upgrade_$DB.log" 2>&1
  RC=$?
  if [ $RC -ne 0 ] || grep -qE "CRITICAL|Traceback" "scratch/upgrade_$DB.log"; then
    echo "FAIL  $DB (exit $RC, see scratch/upgrade_$DB.log)"; FAILED=1
  else
    echo "OK    $DB  ($(( $(date +%s) - START ))s)"
  fi
done
exit $FAILED
