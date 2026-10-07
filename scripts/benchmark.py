# Backend benchmarks -- run through scripts/benchmark.sh (odoo shell on a throwaway clone).
# Service-level timings (no HTTP/network): what the backend itself costs. Numbers are MEASURED here,
# on this machine/container; treat them as a baseline to compare against, not as guarantees.
import gzip
import json
import statistics
import time
import uuid

import odoo
from odoo import api, SUPERUSER_ID

N_PRODUCTS = int(globals().get('N_PRODUCTS', 2000))
N_SALES = 150

company = env.company
wh = env['stock.warehouse'].orsquare_main_warehouse(company)
company.orsquare_auto_godown_transfer = False
Day = env['orsquare.business_day']
if not Day.get_open_day(company):
    Day.open_day(1000.0)
uom750 = env.ref('orsquare.uom_shop_750ml')
sales = env['orsquare.sale.service']
sync = env['orsquare.sync.service']


def stats(label, samples_ms, unit='ms'):
    samples = sorted(samples_ms)
    p50 = statistics.median(samples)
    p95 = samples[int(len(samples) * 0.95) - 1] if len(samples) > 1 else samples[0]
    print('RESULT %-46s n=%-4d p50=%8.1f %s  p95=%8.1f %s  max=%8.1f %s' % (
        label, len(samples), p50, unit, p95, unit, samples[-1], unit))


# ------------------------------------------------------------------ seed
t0 = time.perf_counter()
products = env['product.product']
batch = []
for i in range(N_PRODUCTS):
    batch.append({
        'name': 'Bench Product %04d' % i, 'type': 'consu', 'is_storable': True, 'standard_price': 100.0 + i % 50,
        'list_price': 200.0 + i % 70, 'available_in_pos': True, 'uom_id': uom750.id, 'uom_po_id': uom750.id,
        'taxes_id': [(6, 0, [])], 'supplier_taxes_id': [(6, 0, [])], 'barcode': 'B%08d' % i,
        'orsquare_short_code': 'BP%d' % i})
    if len(batch) == 250:
        products |= env['product.product'].create(batch)
        batch = []
if batch:
    products |= env['product.product'].create(batch)
for p in products[:100]:
    p.product_tmpl_id.orsquare_peg_size_ids = [(0, 0, {'ml': 30, 'price': 70.0}), (0, 0, {'ml': 60, 'price': 120.0})]
Quant = env['stock.quant']
for p in products:
    Quant._update_available_quantity(p, wh.orsquare_counter_id, 50)
    Quant._update_available_quantity(p, wh.orsquare_godown_id, 200)
env.cr.commit()
print('SEED   %d products + stock in %.1fs' % (N_PRODUCTS, time.perf_counter() - t0))

# ------------------------------------------------------------------ bootstrap
env.invalidate_all()
t = time.perf_counter()
boot = sync.bootstrap()
boot_ms = (time.perf_counter() - t) * 1000
raw = json.dumps(boot, default=str).encode()
print('RESULT bootstrap (%d products): %.0f ms, %.0f KB raw, %.0f KB gzip' % (
    N_PRODUCTS, boot_ms, len(raw) / 1024, len(gzip.compress(raw)) / 1024))
env.invalidate_all()
t = time.perf_counter()
sync.bootstrap()
print('RESULT bootstrap (warm cache): %.0f ms' % ((time.perf_counter() - t) * 1000))

# ------------------------------------------------------------------ single checkout latency
def one_sale(i):
    p = products[i % len(products)]
    return {'client_ref': 'B-%s' % uuid.uuid4(), 'lines': [{'product_id': p.id, 'qty': 1}],
            'payments': [{'method': 'cash', 'amount': p.lst_price}]}

lat = []
for i in range(N_SALES):
    payload = one_sale(i)
    t = time.perf_counter()
    sales.settle(payload)
    lat.append((time.perf_counter() - t) * 1000)
env.cr.commit()
stats('checkout: 1 line, cash, real-time stock', lat)

lat = []
for i in range(60):
    payload = {'client_ref': 'M-%s' % uuid.uuid4(),
               'lines': [{'product_id': products[(i * 5 + k) % len(products)].id, 'qty': 1} for k in range(5)],
               'payments': [{'method': 'cash', 'amount': sum(products[(i * 5 + k) % len(products)].lst_price for k in range(5))}]}
    t = time.perf_counter()
    sales.settle(payload)
    lat.append((time.perf_counter() - t) * 1000)
env.cr.commit()
stats('checkout: 5 lines, cash', lat)

# pegs
bot = env['orsquare.opened_bottle'].open_bottle(products[0])
lat = []
for i in range(12):
    t = time.perf_counter()
    sales.settle({'client_ref': 'PG-%s' % uuid.uuid4(), 'lines': [{'peg': {'bottle_id': bot.id, 'ml': 30}}],
                  'payments': [{'method': 'cash', 'amount': 70.0}]})
    lat.append((time.perf_counter() - t) * 1000)
env.cr.commit()
stats('checkout: 30 ml peg from an opened bottle', lat)

# auto godown
company.orsquare_auto_godown_transfer = True
scarce = products[500]
Quant._update_available_quantity(scarce, wh.orsquare_counter_id, -50)   # force Counter to zero
env.cr.commit()
lat = []
for i in range(10):
    t = time.perf_counter()
    sales.settle({'client_ref': 'AG-%s' % uuid.uuid4(), 'lines': [{'product_id': scarce.id, 'qty': 1}],
                  'payments': [{'method': 'cash', 'amount': scarce.lst_price}]})
    lat.append((time.perf_counter() - t) * 1000)
env.cr.commit()
stats('checkout needing an auto-Godown transfer', lat)
company.orsquare_auto_godown_transfer = False

# ------------------------------------------------------------------ offline flush
def mutation(i, dev):
    p = products[(i * 7) % len(products)]
    return {'id': 'F-%s' % uuid.uuid4(), 'device_id': dev, 'device_seq': i + 1, 'kind': 'sale',
            'created_at': odoo.fields.Datetime.now().isoformat(),
            'payload': {'lines': [{'product_id': p.id, 'qty': 1}], 'payments': [{'method': 'cash', 'amount': p.lst_price}]}}

dev = 'bench-%s' % uuid.uuid4().hex[:6]
batch = [mutation(i, dev) for i in range(100)]
t = time.perf_counter()
res = sync.flush(batch)
dt = time.perf_counter() - t
ok = sum(1 for r in res['results'] if r['status'] == 'ok')
print('RESULT offline flush: %d/%d applied in %.2fs  (%.1f ms/bill)' % (ok, len(batch), dt, dt * 1000 / len(batch)))
env.cr.commit()
t = time.perf_counter()
res2 = sync.flush(batch)
print('RESULT offline flush replay (all duplicates): %.0f ms for %d' % ((time.perf_counter() - t) * 1000, len(batch)))

# ------------------------------------------------------------------ delta, reads, reports
seq = boot['seq']
t = time.perf_counter()
d = sync.delta(seq)
print('RESULT delta after ~%d events: %.0f ms (%d events)' % (len(d['events']), (time.perf_counter() - t) * 1000, len(d['events'])))
bills = env['orsquare.api.facade']
lat = []
for q in ('Bench Product 0042', 'B00000100', '1500', 'POS'):
    t = time.perf_counter()
    bills.bill_lookup(q)
    lat.append((time.perf_counter() - t) * 1000)
stats('bill finder (server archive search)', lat)
rep = env['orsquare.reports.service']
for label, fn in (('dashboard', rep.dashboard), ('stock_position (all)', env['orsquare.stock.reports'].stock_position)):
    env.invalidate_all()
    t = time.perf_counter()
    fn()
    print('RESULT %-46s %.0f ms' % (label, (time.perf_counter() - t) * 1000))

# sealing + reports over everything sold above
day = Day.get_open_day(company)
env.cr.commit()
t = time.perf_counter()
day.action_seal(day.live_expected_cash())
env.cr.commit()
print('RESULT seal day with %d orders: %.0f ms' % (env['pos.order'].search_count([]), (time.perf_counter() - t) * 1000))
for label, fn in (('trial_balance', rep.trial_balance), ('profit_and_loss', rep.profit_and_loss),
                  ('balance_sheet', rep.balance_sheet)):
    env.invalidate_all()
    t = time.perf_counter()
    fn()
    print('RESULT %-46s %.0f ms' % (label, (time.perf_counter() - t) * 1000))
print('BENCH DONE')
