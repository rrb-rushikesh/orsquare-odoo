#!/bin/bash
# Usage: scripts/run_tests.sh [test-tags] [db]
# Upgrades the orsquare module and runs its automated tests in the live Odoo container.
TAGS=${1:-/orsquare}
DB=${2:-spike_odoo18}
MSYS_NO_PATHCONV=1 docker exec odoo18-spike-web odoo -c /etc/odoo/odoo.conf -d "$DB" -u orsquare \
  --test-enable --test-tags="$TAGS" --stop-after-init --http-port=8099 --workers=0 2>&1 \
  | grep -E "ERROR|FAIL|Traceback|CRITICAL|Error:|failed" | cut -c1-400 | head -${LINES_MAX:-60}
