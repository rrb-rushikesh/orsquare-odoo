#!/bin/bash
# Drop a shop database AND its filestore (destructive; platform operator only).
# Usage: scripts/drop_shop.sh <db_name>
DB=$1
case "$DB" in orsquare_shop*|orsquare_fresh|orsquare_conc) ;; *) echo "refusing: only shop/scratch databases can be dropped here"; exit 2;; esac
MSYS_NO_PATHCONV=1 docker exec -i odoo18-spike-web python3 - "$DB" <<'PY'
import sys, odoo
odoo.tools.config.parse_config(['-c', '/etc/odoo/odoo.conf'])
from odoo.service.db import exp_drop
print('dropped' if exp_drop(sys.argv[1]) else 'not found')
PY
