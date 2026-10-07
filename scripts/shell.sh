#!/bin/bash
# Usage: scripts/shell.sh <db> < script.py   — runs a python script inside an Odoo shell (env available)
DB=${1:-orsquare_dev}
MSYS_NO_PATHCONV=1 docker exec -i odoo18-spike-web odoo shell -c /etc/odoo/odoo.conf -d "$DB" --http-port=8099 --no-http 2>&1 | grep -v -E "INFO|WARNING odoo\.(modules|addons\.base)|^$"
