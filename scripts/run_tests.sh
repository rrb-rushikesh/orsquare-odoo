#!/bin/bash
# Usage: scripts/run_tests.sh [test-tags] [db]
# Upgrades the orsquare module and runs its automated tests in the live Odoo container.
# Full log: scratch/last_test.log ; this prints failures + the summary line only.
TAGS=${1:-/orsquare}
DB=${2:-orsquare_dev}
cd "$(dirname "$0")/.."
mkdir -p scratch
MSYS_NO_PATHCONV=1 docker exec odoo18-spike-web odoo -c /etc/odoo/odoo.conf -d "$DB" -u orsquare \
  --test-enable --test-tags="$TAGS" --stop-after-init --http-port=8099 --workers=0 > scratch/last_test.log 2>&1
grep -E "ERROR: |FAIL: |CRITICAL|Error: |Exception: |AssertionError|odoo.tests.result" scratch/last_test.log \
  | cut -c1-330 | head -${LINES_MAX:-40}
