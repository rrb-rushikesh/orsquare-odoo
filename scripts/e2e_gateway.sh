#!/bin/bash
# End-to-end proof of the routing guardrails (AGENTS.md section 4) with a REAL reverse proxy:
#   Caddy (forward_auth gate) -> Odoo (orsquare as a server-wide module) -> a provisioned shop database.
#
# Asserts: guests get the landing page; a signed-in visitor of the public domain gets ONLY a 302 to the app
# (no landing bytes); a deep-link refresh serves the SPA shell; the cookie-authenticated API works; logout
# restores the landing page; a wrong shop code gives no hint.
#
# Usage: scripts/e2e_gateway.sh <shop_db> <owner_login> <owner_password>
#        (the shop is created beforehand with scripts/provision_shop.sh)
DB=${1:-orsquare_shop1}; LOGIN=${2:-krishna_owner}; PASS=${3:-Krishna#Owner2026}
cd "$(dirname "$0")/.."
mkdir -p scratch
NET=$(docker inspect odoo18-spike-web --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
PORT=8097
FAILS=0
ok()   { echo "PASS  $1"; }
bad()  { echo "FAIL  $1"; FAILS=$((FAILS+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }

cat > scratch/Caddyfile.e2e <<EOF
{
	auto_https off
	admin off
}
:8081 {
	forward_auth odoo18-spike-web:$PORT {
		uri /api/session/gate
	}
	respond "LANDING-PAGE-HTML-MARKETING-HERO" 200
}
:8082 {
	handle /api/* {
		reverse_proxy odoo18-spike-web:$PORT
	}
	handle {
		respond "SPA-APP-SHELL" 200
	}
}
EOF

MSYS_NO_PATHCONV=1 docker exec odoo18-spike-web bash -c "pkill -f 'http-port=$PORT' ; true"
MSYS_NO_PATHCONV=1 docker exec -d odoo18-spike-web bash -c "odoo -c /etc/odoo/odoo.conf --load=base,web,orsquare --http-port=$PORT --workers=0 > /tmp/odoo_e2e.log 2>&1"
docker rm -f caddy-e2e >/dev/null 2>&1
MSYS_NO_PATHCONV=1 docker run -d --name caddy-e2e --network "$NET" -p 18081:8081 -p 18082:8082 \
  -v "$(pwd -W 2>/dev/null || pwd)\\scratch\\Caddyfile.e2e:/etc/caddy/Caddyfile:ro" caddy:2 >/dev/null
for i in $(seq 1 30); do curl -s -o /dev/null http://localhost:18082/api/health && break; sleep 1; done

J='Content-Type: application/json'; JAR=scratch/e2e_cookies.txt; rm -f $JAR
PUBLIC=http://localhost:18081; APP=http://localhost:18082

check "guest on the public domain receives the landing page" "$(curl -s $PUBLIC/)" "LANDING-PAGE-HTML-MARKETING-HERO"
check "unauthenticated API call is 401 JSON (never a redirect)" "$(curl -s -o /dev/null -w '%{http_code}' $APP/api/session/me)" "401"
check "wrong shop code reveals nothing" "$(curl -s -H "$J" -d '{"shop":"orsquare_nope","login":"x","password":"y"}' $APP/api/session/login | grep -c bad_credentials)" "1"
check "wrong password is 401" "$(curl -s -o /dev/null -w '%{http_code}' -H "$J" -d "{\"shop\":\"$DB\",\"login\":\"$LOGIN\",\"password\":\"nope\"}" $APP/api/session/login)" "401"
check "login succeeds" "$(curl -s -c $JAR -o /dev/null -w '%{http_code}' -H "$J" -d "{\"shop\":\"$DB\",\"login\":\"$LOGIN\",\"password\":\"$PASS\"}" $APP/api/session/login)" "200"

HDRS=$(curl -s -i -b $JAR $PUBLIC/)
check "signed-in visitor of the PUBLIC domain gets a 302" "$(echo "$HDRS" | head -1 | tr -d '\r' | cut -d' ' -f2)" "302"
check "...redirected to the application" "$(echo "$HDRS" | grep -i '^location:' | tr -d '\r' | awk '{print $2}')" "https://app.orsquare.com"
check "...and ZERO landing-page bytes were transmitted" "$(echo "$HDRS" | grep -c LANDING-PAGE)" "0"

check "deep-link refresh (F5 on /sales) serves the SPA shell" "$(curl -s -b $JAR $APP/sales)" "SPA-APP-SHELL"
check "cookie-authenticated API (me)" "$(curl -s -b $JAR $APP/api/session/me | grep -c "\"login\": \"$LOGIN\"")" "1"
check "cookie-authenticated API (dashboard)" "$(curl -s -b $JAR -H "$J" -d '{"service":"reports","method":"dashboard","params":{}}' $APP/api/call | grep -c '"ok": true')" "1"
check "unknown API method is refused (whitelist)" "$(curl -s -o /dev/null -w '%{http_code}' -b $JAR -H "$J" -d '{"service":"sales","method":"unlink","params":{}}' $APP/api/call)" "403"

curl -s -b $JAR -c $JAR -o /dev/null -H "$J" -d '{}' $APP/api/session/logout
check "after logout the public domain serves the landing page again" "$(curl -s -b $JAR $PUBLIC/)" "LANDING-PAGE-HTML-MARKETING-HERO"
check "after logout the API is 401 again" "$(curl -s -o /dev/null -w '%{http_code}' -b $JAR $APP/api/session/me)" "401"

docker rm -f caddy-e2e >/dev/null 2>&1
MSYS_NO_PATHCONV=1 docker exec odoo18-spike-web bash -c "pkill -f 'http-port=$PORT' ; true"
echo
if [ $FAILS -eq 0 ]; then echo "ALL GATEWAY GUARDRAILS HOLD"; else echo "$FAILS GATEWAY CHECK(S) FAILED"; exit 1; fi
