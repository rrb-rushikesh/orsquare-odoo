# Platform registry scale benchmark. Run inside the platform database through an Odoo shell:
#   docker exec -i odoo18-spike-web odoo shell -c /etc/odoo/odoo.conf -d orsquare_platform --no-http < scripts/bench_platform.py
# It seeds N shops / M audit rows / 3N sign-in keys INSIDE ONE TRANSACTION, times the calls the Developer Console
# makes, and ROLLS BACK: nothing is left behind. Numbers are measured on this machine; they are not guarantees.
import statistics
import time

N_SHOPS = 10_000
N_AUDIT = 300_000

env['ir.config_parameter'].sudo().set_param('orsquare.platform.require_mfa', '0')
cr = env.cr
t0 = time.perf_counter()
cr.execute("""
    INSERT INTO orsquare_platform_shop (name, code, owner_name, owner_login, phone, plan, status, expires_on, preset, create_date, write_date)
    SELECT 'Bench Shop ' || lpad(i::text, 6, '0'), 'orsquare_shop_bench_' || lpad(i::text, 6, '0'),
           'Owner ' || i, 'bench_owner_' || i || '@example.com', '8' || lpad(i::text, 9, '0'),
           (ARRAY['trial','basic','pro'])[1 + i %% 3],
           (ARRAY['active','active','active','active','suspended','archived'])[1 + i %% 6],
           CASE i %% 4 WHEN 0 THEN NULL WHEN 1 THEN current_date - 5 WHEN 2 THEN current_date + 3 ELSE current_date + 90 END,
           'wine_shop', now() at time zone 'utc' - (i || ' minutes')::interval, now() at time zone 'utc'
      FROM generate_series(1, %s) AS i""", (N_SHOPS,))
cr.execute("""
    INSERT INTO orsquare_platform_login (key, shop_code, kind, create_date, write_date)
    SELECT 'k' || n || '_' || i, 'orsquare_shop_bench_' || lpad(i::text, 6, '0'), 'staff', now(), now()
      FROM generate_series(1, %s) AS i, generate_series(1, 3) AS n""", (N_SHOPS,))
cr.execute("""
    INSERT INTO orsquare_platform_audit (actor, action, shop_code, detail, create_date, write_date)
    SELECT 'op' || (i %% 5), (ARRAY['suspend','reactivate','extend','studio','create_shop','staff_update'])[1 + i %% 6],
           'orsquare_shop_bench_' || lpad((1 + i %% %s)::text, 6, '0'), 'detail ' || i,
           now() at time zone 'utc' - (i || ' seconds')::interval, now()
      FROM generate_series(1, %s) AS i""", (N_SHOPS, N_AUDIT))
for table in ('orsquare_platform_shop', 'orsquare_platform_login', 'orsquare_platform_audit'):
    cr.execute('ANALYZE %s' % table)
env.invalidate_all()
print("seeded %d shops, %d audit rows, %d keys in %.1fs" % (N_SHOPS, N_AUDIT, N_SHOPS * 3, time.perf_counter() - t0))

svc = env['orsquare.platform.service'].with_user(env.ref('base.user_admin'))


def bench(label, fn, runs=7):
    times = []
    for _ in range(runs):
        t = time.perf_counter()
        fn()
        times.append((time.perf_counter() - t) * 1000)
    times.sort()
    print("%-46s median %7.1f ms   p90 %7.1f ms" % (label, statistics.median(times), times[int(len(times) * 0.9) - 1]))


bench("fleet: first page (50), newest first", lambda: svc.fleet())
bench("fleet: page 100 of 200", lambda: svc.fleet(page=100))
bench("fleet: search by name fragment", lambda: svc.fleet(search='Shop 004'))
bench("fleet: search by phone fragment", lambda: svc.fleet(search='8000004'))
bench("fleet: search with no result", lambda: svc.fleet(search='zzzzqqq'))
bench("fleet: filter expiring", lambda: svc.fleet(lifecycle='expiring'))
bench("fleet: filter trial", lambda: svc.fleet(lifecycle='trial'))
bench("fleet: sort by expiry", lambda: svc.fleet(sort='expires', desc=False))
bench("fleet: plan=pro, sort by name", lambda: svc.fleet(plan='pro', sort='name', desc=False))
bench("audit: first page", lambda: svc.audit())
bench("audit: one shop", lambda: svc.audit(shop_code='orsquare_shop_bench_004242'))
bench("audit: action + date range", lambda: svc.audit(action='suspend', date_from='2000-01-01'))
bench("audit: text search", lambda: svc.audit(q='detail 29999'))
bench("system diagnostics", lambda: svc.system(), runs=3)
bench("plans (with shop counts)", lambda: svc.plans())
t = time.perf_counter()
cr.execute("SELECT shop_code FROM orsquare_platform_login WHERE key = 'k2_4242'")
cr.fetchone()
print("%-46s %7.2f ms" % ("sign-in directory lookup (1 key of 30,000)", (time.perf_counter() - t) * 1000))
cr.execute("EXPLAIN (FORMAT TEXT) SELECT id FROM orsquare_platform_shop WHERE name ILIKE '%Shop 004%' LIMIT 50")
print("search plan:", " | ".join(r[0].strip() for r in cr.fetchall())[:240])
cr.rollback()
print("rolled back: nothing kept")
