#!/bin/bash
# Provision one shop = one database: clone the template (SQL + filestore, via Odoo's own duplicate),
# then configure the shop and its owner. The default admin password of the template is neutralised.
#
# Usage: scripts/provision_shop.sh <db_name> "<Shop Name>" <owner_login> <owner_password> \
#            ["<Owner Name>"] [state_code=MH] [preset=wine_shop] [template=orsquare_template]
set -e
DB=$1; SHOP=$2; LOGIN=$3; PASS=$4
OWNER=${5:-Owner}; STATE=${6:-MH}; PRESET=${7:-wine_shop}; TEMPLATE=${8:-orsquare_template}
if [ -z "$DB" ] || [ -z "$SHOP" ] || [ -z "$LOGIN" ] || [ -z "$PASS" ]; then
  echo "usage: $0 <db_name> \"<Shop Name>\" <owner_login> <owner_password> [owner name] [state] [preset] [template]"; exit 2
fi
case "$DB" in *[!a-z0-9_]*|"") echo "database name may only contain a-z 0-9 _"; exit 2;; esac
START=$(date +%s%N)
MSYS_NO_PATHCONV=1 docker exec -i odoo18-spike-web python3 - "$TEMPLATE" "$DB" <<'PY'
import sys, odoo
odoo.tools.config.parse_config(['-c', '/etc/odoo/odoo.conf'])
from odoo.service.db import exp_duplicate_database
exp_duplicate_database(sys.argv[1], sys.argv[2])
PY
CLONED=$(date +%s%N)
CFG=$(cat <<PY
import json
res = env['orsquare.shop.bootstrap'].configure_shop(
    name=${SHOP@Q}, owner_name=${OWNER@Q}, owner_login=${LOGIN@Q}, owner_password=${PASS@Q},
    state_code=${STATE@Q}, preset=${PRESET@Q})
env.cr.commit()
print('PROVISIONED ' + json.dumps(res))
PY
)
echo "$CFG" | MSYS_NO_PATHCONV=1 docker exec -i odoo18-spike-web odoo shell -c /etc/odoo/odoo.conf -d "$DB" --http-port=8099 --no-http 2>&1 | grep -E "PROVISIONED|Error|Traceback"
END=$(date +%s%N)
echo "clone: $(( (CLONED - START) / 1000000 )) ms   total: $(( (END - START) / 1000000 )) ms"
