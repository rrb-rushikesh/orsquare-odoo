#!/bin/bash
# Regenerate docs/backend-api-reference.md from the live API registry.
cd "$(dirname "$0")/.."
MSYS_NO_PATHCONV=1 docker exec -i odoo18-spike-web odoo shell -c /etc/odoo/odoo.conf -d "${1:-orsquare_dev}" \
  --http-port=8099 --no-http < scripts/gen_api_docs.py 2>&1 | grep -E "GENERATED|Error|Traceback"
MSYS_NO_PATHCONV=1 docker cp odoo18-spike-web:/tmp/backend-api-reference.md docs/backend-api-reference.md
