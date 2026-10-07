#!/bin/bash
# Build the shop TEMPLATE database from zero: Odoo + dependencies + orsquare (India chart, topology,
# accounts, tax regimes, POS config). Every new shop is a ~200 ms clone of it.
# Usage: scripts/build_template.sh [template-db]   (default: orsquare_template; drops and recreates it)
#
# The Indian chart of accounts must be selected BEFORE accounting is installed (as Odoo's own database
# creation does), so: 1) install base, 2) set the company to India/INR, 3) install l10n_in (loads the
# Indian chart), 4) install orsquare (and, through it, POS/stock/purchase on top of that chart).
T=${1:-orsquare_template}
cd "$(dirname "$0")/.."
mkdir -p scratch
PSQL() { MSYS_NO_PATHCONV=1 docker exec odoo18-spike-db psql -U odoo -d postgres -v ON_ERROR_STOP=1 -c "$1" >/dev/null; }
ODOO() { MSYS_NO_PATHCONV=1 docker exec odoo18-spike-web odoo -c /etc/odoo/odoo.conf -d "$T" --without-demo=all --stop-after-init --http-port=8099 --workers=0 "$@"; }
PSQL "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$T' AND pid <> pg_backend_pid()"
PSQL "DROP DATABASE IF EXISTS $T"
START=$(date +%s)
{
  ODOO -i base
  echo "env['res.currency'].browse(env.ref('base.INR').id).active = True
env.company.write({'country_id': env.ref('base.in').id, 'currency_id': env.ref('base.INR').id})
env.cr.commit()" | MSYS_NO_PATHCONV=1 docker exec -i odoo18-spike-web odoo shell -c /etc/odoo/odoo.conf -d "$T" --http-port=8099 --no-http
  ODOO -i l10n_in
  ODOO -i orsquare
} > scratch/build_template.log 2>&1
RC=$?
echo "template build exit=$RC in $(( $(date +%s) - START ))s (log: scratch/build_template.log)"
grep -E "ERROR|CRITICAL|Traceback" scratch/build_template.log | head -10
