# Concurrency invariants for ORSquare checkout -- run through scripts/concurrency_test.sh (odoo shell).
#
# Real PostgreSQL connections, real transactions (REPEATABLE READ, as in production), real threads.
# Proves: zero overselling, zero negative stock, exactly-once billing, exact peg conservation.
import threading
import time
import uuid

import odoo
from odoo import api, SUPERUSER_ID
from odoo.exceptions import UserError
from odoo.service.model import retrying

DB = env.cr.dbname
registry = odoo.registry(DB)
failures = []


def check(name, cond, detail=''):
    print(('PASS  ' if cond else 'FAIL  ') + name + ((' -- ' + str(detail)) if detail else ''))
    if not cond:
        failures.append(name)


def run_parallel(n, payload_factory, service='orsquare.sale.service', method='settle'):
    """n threads, each in its own cursor/transaction, released together. Returns (ok, errors)."""
    barrier = threading.Barrier(n)
    results = [None] * n

    def worker(i):
        with registry.cursor() as cr:
            wenv = api.Environment(cr, SUPERUSER_ID, {})
            payload = payload_factory(i)
            barrier.wait()
            try:
                res = retrying(lambda: getattr(wenv[service], method)(payload), wenv)
                cr.commit()
                results[i] = ('ok', res)
            except UserError as exc:
                cr.rollback()
                results[i] = ('err', exc.args[0])
            except Exception as exc:  # anything else is a bug
                cr.rollback()
                results[i] = ('crash', repr(exc))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    t0 = time.perf_counter()
    [t.start() for t in threads]
    [t.join() for t in threads]
    elapsed = time.perf_counter() - t0
    ok = [r[1] for r in results if r and r[0] == 'ok']
    errs = [r[1] for r in results if r and r[0] == 'err']
    crashes = [r[1] for r in results if r and r[0] == 'crash']
    return ok, errs, crashes, elapsed


def qty(env_, product, location):
    env_.cr.execute("SELECT COALESCE(SUM(quantity),0) FROM stock_quant WHERE product_id=%s AND location_id=%s",
                    [product.id, location.id])
    return env_.cr.fetchone()[0]


def negative_quants(env_, product):
    env_.cr.execute("SELECT COUNT(*) FROM stock_quant sq JOIN stock_location l ON l.id=sq.location_id "
                    "WHERE sq.product_id=%s AND l.usage='internal' AND sq.quantity < -0.0000005", [product.id])
    return env_.cr.fetchone()[0]


# ---------------------------------------------------------------- setup (committed)
company = env.company
wh = env['stock.warehouse'].orsquare_main_warehouse(company)
company.orsquare_auto_godown_transfer = False
Day = env['orsquare.business_day']
if not Day.get_open_day(company):
    Day.open_day(1000.0)
uom = env.ref('orsquare.uom_shop_750ml')


def product(name, cost=1500.0):
    return env['product.product'].create({
        'name': name, 'type': 'consu', 'is_storable': True, 'standard_price': cost, 'list_price': 2000.0,
        'available_in_pos': True, 'uom_id': uom.id, 'uom_po_id': uom.id, 'taxes_id': [(6, 0, [])],
        'supplier_taxes_id': [(6, 0, [])]})


def stock_in(prod, n, loc):
    q = env['stock.quant'].with_context(inventory_mode=True).create({
        'product_id': prod.id, 'location_id': loc.id, 'inventory_quantity': n})
    q.action_apply_inventory()


def bill(prod_id, n=1, price=2000.0):
    return lambda i: {'client_ref': 'C-%s' % uuid.uuid4(), 'lines': [{'product_id': prod_id, 'qty': n}],
                      'payments': [{'method': 'cash', 'amount': price * n}]}


# ---------------------------------------------------------------- A: the last bottle
A = product('CONC A last bottle')
stock_in(A, 1, wh.orsquare_counter_id)
env.cr.commit()
ok, errs, crashes, dt = run_parallel(10, bill(A.id))
env.invalidate_all()
check('A1 exactly one of 10 cashiers sells the last bottle', len(ok) == 1, 'ok=%d errs=%d crashes=%s' % (len(ok), len(errs), crashes))
check('A2 the other 9 get a clean stock-out message', all('Insufficient' in e for e in errs), errs[:2])
check('A3 counter is exactly 0, never negative', qty(env, A, wh.orsquare_counter_id) == 0)
check('A4 no negative internal quant anywhere', negative_quants(env, A) == 0)
check('A5 exactly one order exists', env['pos.order'].search_count([('lines.product_id', '=', A.id)]) == 1)
print('      (10 concurrent checkouts in %.2fs)' % dt)

# ---------------------------------------------------------------- B: auto-Godown under contention
company.orsquare_auto_godown_transfer = True
env.cr.commit()
B = product('CONC B auto godown')
stock_in(B, 2, wh.orsquare_counter_id)
stock_in(B, 10, wh.orsquare_godown_id)
env.cr.commit()
ok, errs, crashes, dt = run_parallel(8, bill(B.id, 3, 2000.0))     # wants 24, only 12 exist
env.invalidate_all()
sold = sum(r['total'] for r in ok) / 2000.0
check('B1 exactly 4 bills of 3 succeed (12 units exist)', len(ok) == 4 and sold == 12, 'ok=%d crashes=%s' % (len(ok), crashes))
check('B2 the rest fail with Godown stock-out', len(errs) == 4 and all('Insufficient' in e for e in errs), errs[:2])
check('B3 godown+counter fully drained, zero negative', qty(env, B, wh.orsquare_counter_id) + qty(env, B, wh.orsquare_godown_id) == 0
      and negative_quants(env, B) == 0)
check('B4 every auto-transfer is a real picking with audit origin',
      env['stock.picking'].search_count([('origin', 'like', 'Auto-Godown Transfer for Sale')]) >= 1)
print('      (8 concurrent checkouts in %.2fs)' % dt)

# ---------------------------------------------------------------- C: pegs from one bottle
company.orsquare_auto_godown_transfer = False
C = product('CONC C peg bottle', 1500.0)
stock_in(C, 1, wh.orsquare_counter_id)
env.cr.commit()
bottle = env['orsquare.opened_bottle'].open_bottle(C)
env.cr.commit()
bid = bottle.id
ok, errs, crashes, dt = run_parallel(6, lambda i: {
    'client_ref': 'P-%s' % uuid.uuid4(), 'lines': [{'peg': {'bottle_id': bid, 'ml': 180}, 'price': 400.0}],
    'payments': [{'method': 'cash', 'amount': 400.0}]})
env.invalidate_all()
bottle = env['orsquare.opened_bottle'].browse(bid)
check('C1 only 4 x 180 ml fit in a 750 ml bottle', len(ok) == 4, 'ok=%d errs=%d crashes=%s' % (len(ok), len(errs), crashes))
check('C2 30 ml remain, derived from the quant', abs(bottle.remaining_ml - 30.0) < 0.01, bottle.remaining_ml)
check('C3 over-pours are rejected', len(errs) == 2 and all('left' in e for e in errs), errs[:2])
bottle.action_finish(reason='dregs')
env.cr.commit()
env.invalidate_all()
env.cr.execute("SELECT COALESCE(SUM(value),0) FROM stock_valuation_layer WHERE product_id=%s", [C.id])
check('C4 after scrap the asset is exactly INR 0.00 (conserved)', round(env.cr.fetchone()[0], 2) == 0.0)

# ---------------------------------------------------------------- D: the same bill replayed concurrently
D = product('CONC D idempotency')
stock_in(D, 5, wh.orsquare_counter_id)
env.cr.commit()
shared = 'SAME-BILL-%s' % uuid.uuid4()
ok, errs, crashes, dt = run_parallel(8, lambda i: {
    'client_ref': shared, 'lines': [{'product_id': D.id, 'qty': 1}], 'payments': [{'method': 'cash', 'amount': 2000.0}]})
env.invalidate_all()
orders = env['pos.order'].search([('orsquare_client_ref', '=', shared)])
check('D1 the same client reference creates exactly one order', len(orders) == 1, 'orders=%d crashes=%s' % (len(orders), crashes))
check('D2 every replay is answered (ok/duplicate), none crash', len(ok) == 8 and not crashes, 'ok=%d' % len(ok))
check('D3 stock deducted exactly once', qty(env, D, wh.orsquare_counter_id) == 4)

# ---------------------------------------------------------------- E: mixed storm, global conservation
E = product('CONC E storm', 1000.0)
stock_in(E, 7, wh.orsquare_counter_id)
stock_in(E, 7, wh.orsquare_godown_id)
company.orsquare_auto_godown_transfer = True
env.cr.commit()
ok, errs, crashes, dt = run_parallel(20, bill(E.id, 1, 2000.0))     # 14 units, 20 buyers
env.invalidate_all()
check('E1 exactly 14 of 20 succeed', len(ok) == 14 and not crashes, 'ok=%d errs=%d crashes=%s' % (len(ok), len(errs), crashes))
check('E2 nothing left, nothing negative', qty(env, E, wh.orsquare_counter_id) + qty(env, E, wh.orsquare_godown_id) == 0
      and negative_quants(env, E) == 0)
env.cr.execute("SELECT COALESCE(SUM(value),0) FROM stock_valuation_layer WHERE product_id=%s", [E.id])
check('E3 valuation layers net to INR 0.00 after selling everything', round(env.cr.fetchone()[0], 2) == 0.0)
check('E4 revenue == units sold x price',
      sum(r['total'] for r in ok) == 14 * 2000.0)
print('      (20 concurrent checkouts in %.2fs)' % dt)

print('')
print('ALL CONCURRENCY INVARIANTS HOLD' if not failures else 'CONCURRENCY FAILURES: %s' % failures)
