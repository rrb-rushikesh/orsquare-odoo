#!/bin/bash
# End-to-end proof of realtime delivery and channel authorisation with a REAL Centrifugo + Redis:
#   Odoo publishes after commit -> Centrifugo -> WebSocket clients holding Odoo-issued tokens.
# Asserts: a cashier is subscribed only to shop:<db> and receives NO amounts; an owner is also subscribed to
# shop:<db>:money and receives the amounts; shops are isolated by database name; a client cannot subscribe
# itself to the money channel.
# Usage: scripts/e2e_realtime.sh [shop_db]    (needs docker network access to pull python/centrifugo/redis images)
DB=${1:-orsquare_shop1}
cd "$(dirname "$0")/.."
mkdir -p scratch
NET=$(docker inspect odoo18-spike-web --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
SECRET=e2e-hmac-secret-0123456789abcdef0123456789abcdef
APIKEY=e2e-api-key-0123456789
FAILS=0
check(){ if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (expected '$3', got '$2')"; FAILS=$((FAILS+1)); fi; }

cat > scratch/centrifugo.e2e.json <<EOF
{
  "token_hmac_secret_key": "$SECRET",
  "api_key": "$APIKEY",
  "allowed_origins": ["*"],
  "engine": "redis",
  "redis_address": "redis-e2e:6379",
  "namespaces": [{"name": "shop", "history_size": 50, "history_ttl": "60s", "allow_subscribe_for_client": false}]
}
EOF

docker rm -f redis-e2e centrifugo-e2e >/dev/null 2>&1
docker run -d --name redis-e2e --network "$NET" redis:7 >/dev/null
MSYS_NO_PATHCONV=1 docker run -d --name centrifugo-e2e --network "$NET" \
  -v "$(pwd -W 2>/dev/null || pwd)\\scratch\\centrifugo.e2e.json:/centrifugo/config.json:ro" \
  centrifugo/centrifugo:v5 centrifugo --config=/centrifugo/config.json >/dev/null
sleep 4

# 1. configure the shop + mint tokens for a cashier and an owner (committed so they are real)
cat > scratch/rt_setup.py <<EOF
params = env['ir.config_parameter'].sudo()
params.set_param('orsquare.centrifugo_url', 'http://centrifugo-e2e:8000')
params.set_param('orsquare.centrifugo_api_key', '$APIKEY')
params.set_param('orsquare.centrifugo_secret', '$SECRET')
svc = env['orsquare.realtime.service']
def user(login, role):
    u = env['res.users'].search([('login', '=', login)])
    if not u:
        u = env['res.users'].create({'name': login, 'login': login, 'password': 'RtPass#12345678',
                                     'groups_id': [(6, 0, [env.ref(role).id, env.ref('base.group_user').id])]})
    return u
cashier = user('rt_cashier', 'orsquare.group_orsquare_cashier')
owner = user('rt_owner', 'orsquare.group_orsquare_owner')
env.cr.commit()
print('TOKEN_CASHIER ' + svc.with_user(cashier).token()['token'])
print('TOKEN_OWNER ' + svc.with_user(owner).token()['token'])
EOF
OUT=$(MSYS_NO_PATHCONV=1 docker exec -i odoo18-spike-web odoo shell -c /etc/odoo/odoo.conf -d "$DB" --http-port=8099 --no-http < scratch/rt_setup.py 2>&1)
TC=$(echo "$OUT" | grep '^TOKEN_CASHIER ' | cut -d' ' -f2); TO=$(echo "$OUT" | grep '^TOKEN_OWNER ' | cut -d' ' -f2)
[ -n "$TC" ] && [ -n "$TO" ] && echo "PASS  Odoo issued tokens" || { echo "FAIL  no tokens: $OUT" | head -5; FAILS=$((FAILS+1)); }

# 2. two WebSocket clients (python container) listen for 20 s
cat > scratch/rt_client.py <<'EOF'
import asyncio, json, sys
import websockets

async def run(name, token, secs):
    got = {'subs': [], 'pubs': []}
    async with websockets.connect('ws://centrifugo-e2e:8000/connection/websocket') as ws:
        await ws.send(json.dumps({'id': 1, 'connect': {'token': token}}))
        reply = json.loads((await ws.recv()).split('\n')[0])
        got['subs'] = sorted((reply.get('connect') or {}).get('subs', {}).keys())
        # a client trying to subscribe itself to the money channel must be refused
        await ws.send(json.dumps({'id': 2, 'subscribe': {'channel': 'shop:%s:money' % sys.argv[1]}}))
        deadline = asyncio.get_event_loop().time() + secs
        got['self_subscribe_error'] = None
        while asyncio.get_event_loop().time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            for line in raw.split('\n'):
                if not line.strip():
                    continue
                msg = json.loads(line)
                if msg.get('id') == 2 and 'error' in msg:
                    got['self_subscribe_error'] = msg['error'].get('code')
                push = msg.get('push')
                if push and 'pub' in push:
                    got['pubs'].append({'channel': push['channel'], 'data': push['pub']['data']})
    print('RESULT ' + name + ' ' + json.dumps(got))

asyncio.run(run(sys.argv[2], sys.argv[3], int(sys.argv[4])))
EOF
run_client() {
  MSYS_NO_PATHCONV=1 docker run --rm --network "$NET" -v "$(pwd -W 2>/dev/null || pwd)\\scratch\\rt_client.py:/rt_client.py:ro" \
    python:3.12-slim sh -c "pip install -q websockets >/dev/null 2>&1 && python /rt_client.py $DB $1 $2 18" > "scratch/rt_$1.out" 2>&1
}
run_client cashier "$TC" & run_client owner "$TO" &
sleep 14   # clients install websockets and connect

# 3. Odoo publishes a sale after commit
cat > scratch/rt_publish.py <<'EOF'
env['orsquare.event'].publish(env.company, 'sale_settled', {'order_id': 4242, 'name': 'RT/0001'}, money={'total': 1234.5})
env.cr.commit()
print('PUBLISHED')
EOF
MSYS_NO_PATHCONV=1 docker exec -i odoo18-spike-web odoo shell -c /etc/odoo/odoo.conf -d "$DB" --http-port=8099 --no-http < scratch/rt_publish.py 2>&1 | grep PUBLISHED
wait

# 4. assertions
CASH=$(grep '^RESULT' scratch/rt_cashier.out | cut -d' ' -f3-); OWN=$(grep '^RESULT' scratch/rt_owner.out | cut -d' ' -f3-)
py() { python - "$@" <<'PY'
import json, sys
d = json.loads(sys.argv[1]); key = sys.argv[2]
if key == 'subs': print(','.join(d['subs']))
elif key == 'channels': print(','.join(sorted(p['channel'] for p in d['pubs'])))
elif key == 'money_leak': print(any('money' in p['data'] for p in d['pubs'] if not p['channel'].endswith(':money')))
elif key == 'amount_seen': print(any(p['data'].get('money', {}).get('total') == 1234.5 for p in d['pubs']))
elif key == 'amount_anywhere': print('1234.5' in json.dumps(d['pubs']))
elif key == 'selfsub': print(d.get('self_subscribe_error') is not None)
PY
}
check "cashier is subscribed ONLY to shop:$DB" "$(py "$CASH" subs)" "shop:$DB"
check "owner is subscribed to shop:$DB and shop:$DB:money" "$(py "$OWN" subs)" "shop:$DB,shop:$DB:money"
check "cashier received the sale event" "$(py "$CASH" channels)" "shop:$DB"
check "cashier saw NO amount anywhere on the wire" "$(py "$CASH" amount_anywhere)" "False"
check "owner received the sale on both channels" "$(py "$OWN" channels)" "shop:$DB,shop:$DB:money"
check "owner received the amount on the money channel" "$(py "$OWN" amount_seen)" "True"
check "the non-money channel never carries an amount" "$(py "$OWN" money_leak)" "False"
check "a client cannot subscribe itself to the money channel" "$(py "$CASH" selfsub)" "True"

docker rm -f redis-e2e centrifugo-e2e >/dev/null 2>&1
echo
if [ $FAILS -eq 0 ]; then echo "ALL REALTIME CHECKS HOLD"; else echo "$FAILS REALTIME CHECK(S) FAILED"; cat scratch/rt_cashier.out scratch/rt_owner.out | head -20; exit 1; fi
