#!/bin/bash
# Usage: scripts/run_platform_tests.sh [test-tags]
# Upgrades the orsquare_platform module in the platform database and runs its automated tests (Developer Console backend).
# Full log: scratch/last_platform_test.log ; this prints failures + the summary line only.
TAGS=${1:-/orsquare_platform}
cd "$(dirname "$0")/.."
mkdir -p scratch
MSYS_NO_PATHCONV=1 docker exec odoo18-spike-web odoo -c /etc/odoo/odoo.conf -d orsquare_platform -u orsquare_platform \
  --test-enable --test-tags="$TAGS" --stop-after-init --http-port=8099 --workers=0 > scratch/last_platform_test.log 2>&1
grep -E "ERROR: |FAIL: |CRITICAL|Error: |Exception: |AssertionError|odoo.tests.result" scratch/last_platform_test.log \
  | cut -c1-330 | head -${LINES_MAX:-40}
