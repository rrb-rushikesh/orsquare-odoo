#!/bin/bash
# Create (or upgrade) the PLATFORM database: the Developer Console's fleet registry + audit trail.
# One per installation. Developers are Odoo system users of this database.
#
# Usage: scripts/build_platform.sh [db=orsquare_platform] [dev_login] [dev_password]
#   With a login+password it also creates/updates that developer account.
DB=${1:-orsquare_platform}; LOGIN=$2; PASS=$3
cd "$(dirname "$0")/.."
EXISTS=$(docker exec odoo18-spike-db psql -U odoo -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB'")
if [ -z "$EXISTS" ]; then
  echo "creating $DB ..."
  MSYS_NO_PATHCONV=1 docker exec odoo18-spike-web odoo -c /etc/odoo/odoo.conf -d "$DB" -i orsquare_platform --stop-after-init --without-demo=all 2>&1 | tail -2
else
  echo "upgrading $DB ..."
  MSYS_NO_PATHCONV=1 docker exec odoo18-spike-web odoo -c /etc/odoo/odoo.conf -d "$DB" -u orsquare_platform --stop-after-init 2>&1 | tail -2
fi
cat > scratch/platform_setup.py <<PY
import secrets
params = env['ir.config_parameter'].sudo()
params.set_param('orsquare.dev_console', '1')          # the gate sends system users of THIS database to /dev
params.set_param('orsquare.app_url', params.get_param('orsquare.app_url') or 'https://app.orsquare.com')
params.set_param('orsquare.platform.template_db', params.get_param('orsquare.platform.template_db') or 'orsquare_template')
admin = env.ref('base.user_admin', raise_if_not_found=False)
if admin:
    admin.sudo().write({'password': secrets.token_urlsafe(32)})      # never keep the default admin/admin
login, password = '${LOGIN}', '${PASS}'
if login and password:
    user = env['res.users'].search([('login', '=', login)])
    vals = {'name': login, 'login': login, 'password': password, 'groups_id': [(4, env.ref('base.group_system').id)]}
    user.write(vals) if user else env['res.users'].create(vals)
env.cr.commit()
print('PLATFORM READY')
PY
MSYS_NO_PATHCONV=1 docker exec -i odoo18-spike-web odoo shell -c /etc/odoo/odoo.conf -d "$DB" --http-port=8099 --no-http < scratch/platform_setup.py 2>&1 | grep -E "PLATFORM READY|Error|Traceback"
