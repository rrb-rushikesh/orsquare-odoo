# -*- coding: utf-8 -*-
"""Local-first sync protocol: single bootstrap bundle, incremental delta, idempotent ordered flush.

* ``bootstrap``  one round-trip workspace seed (no request waterfall).
* ``delta``      events after ``since_seq`` (+ small patches), so a device catches up cheaply.
* ``flush``      the offline outbox: each mutation carries a client UUID and a per-device monotonic
                 sequence.  Replays return the stored answer (never double-post); a gap or an older
                 sequence is refused so mutations can never execute out of order.  Every mutation runs
                 in its own savepoint: one bad bill never blocks the rest of the batch.
Performance figures (150 ms bootstrap, ~200 KB) are benchmark targets, to be measured.
"""
import logging
from datetime import timedelta

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, RedirectWarning, UserError, ValidationError

from .security_utils import require_staff

_logger = logging.getLogger(__name__)

STOCK_EVENTS = {'sale_settled', 'stock_changed', 'purchase_recorded', 'purchase_returned',
                'bottle_opened', 'bottle_closed', 'shop_wiped'}
OVERLAP_SECONDS = 120
DAY_EVENTS = {'sale_settled', 'day_sealed', 'payment_recorded', 'cash_entry', 'shop_wiped'}


class OrsquareSyncLog(models.Model):
    """One row per flushed mutation: the idempotent answer store and the ordering cursor."""
    _name = 'orsquare.sync_log'
    _description = "Offline Mutation Log"
    _order = 'id'

    company_id = fields.Many2one('res.company', required=True, default=lambda s: s.env.company, index=True)
    mutation_id = fields.Char(required=True, index=True)
    device_id = fields.Char(required=True, index=True)
    device_seq = fields.Integer(required=True)
    kind = fields.Char(required=True)
    status = fields.Selection([('ok', 'Applied'), ('error', 'Rejected')], required=True)
    result = fields.Json()
    error_code = fields.Char()
    error_message = fields.Text()
    user_id = fields.Many2one('res.users', default=lambda s: s.env.uid)

    _sql_constraints = [
        ('mutation_unique', 'unique(mutation_id, company_id)', "This mutation was already processed."),
        ('device_seq_unique', 'unique(device_id, device_seq, company_id)', "This device sequence was already used."),
    ]


class OrsquareSyncService(models.AbstractModel):
    _name = 'orsquare.sync.service'
    _description = "ORSquare Offline Sync Service"

    # mutation kind -> (callable name on a service, allowed roles check delegated to the service itself)
    MUTATIONS = {
        'sale': ('orsquare.sale.service', 'settle'),
        'purchase': ('orsquare.purchase.service', 'record_bill'),
        'stock_transfer': ('orsquare.stock.service', 'manual_transfer_api'),
        'open_bottle': ('orsquare.opened_bottle', 'open_bottle_api'),
        'finish_bottle': ('orsquare.opened_bottle', 'finish_bottle_api'),
        'cash_entry': ('orsquare.cashflow.service', 'new_entry'),
        'khata_receipt': ('orsquare.accounts.service', 'receive_payment'),
    }
    # explicitly NOT allowed offline: new products, sealing the day, settings, wipes (need the server)

    # ------------------------------------------------------------------ bootstrap
    @api.model
    def bootstrap(self):
        require_staff(self.env)
        env = self.env
        company = env.company
        staff = env['orsquare.staff.service']
        me = staff.me()
        catalog = env['orsquare.catalog.service']
        day = env['orsquare.business_day'].sudo().search([
            ('company_id', '=', company.id), ('date', '=', company.orsquare_effective_business_date())], limit=1)
        money = me['flags']['can_see_money']
        bundle = {
            'schema': 1,
            'seq': env['orsquare.event'].latest_seq(company),
            'server_ts': fields.Datetime.to_string(fields.Datetime.now()),
            'me': me,
            'products': catalog.list_products(limit=10000),
            'units': catalog.units(),
            'brands': catalog.brands(),
            'categories': catalog.categories(),
            'regimes': catalog.tax_regimes(),
            'stock': env['orsquare.stock.reports'].stock_position(),
            'open_bottles': env['orsquare.opened_bottle'].tray(),
            'day': day.summary() if (day and money) else ({'id': day.id, 'date': str(day.date), 'state': day.state}
                                                         if day else None),
            'customers': env['orsquare.accounts.service'].directory('customers', limit=1000)['rows'],
            'suppliers': env['orsquare.accounts.service'].directory('suppliers', limit=1000)['rows'],
            'payment_modes': ['cash', 'upi', 'khata'],
            'floors': catalog.floors() if company.orsquare_feature_tables else [],
            'tables': env['orsquare.tab.service'].table_status() if company.orsquare_feature_tables else [],
            'promos': [p for p in env['orsquare.promo'].list_promos() if p['active']],
            'discrepancies_open': env['orsquare.stock_discrepancy'].search_count([('state', '=', 'open')]),
        }
        return bundle

    # ------------------------------------------------------------------ delta
    @api.model
    def delta(self, since_seq, since_ts=None, limit=500):
        require_staff(self.env)
        company = self.env.company
        Event = self.env['orsquare.event']
        since_seq = int(since_seq or 0)
        latest = Event.latest_seq(company)
        if since_seq > latest:
            return {'reset': True, 'seq': latest, 'reason': 'cursor ahead of server (restore or wipe)'}
        events = Event.since(company, since_seq, limit=limit)
        types = {e['type'] for e in events}
        patches = {}
        if types & STOCK_EVENTS:
            patches['stock'] = self.env['orsquare.stock.reports'].stock_position()
            patches['open_bottles'] = self.env['orsquare.opened_bottle'].tray()
        if types & DAY_EVENTS:
            day = self.env['orsquare.business_day'].sudo().search([
                ('company_id', '=', company.id), ('date', '=', company.orsquare_effective_business_date())], limit=1)
            if day and (self.env.su or self.env.user.has_group('orsquare.group_orsquare_can_see_money')):
                patches['day'] = day.summary()
        if 'tab_changed' in types and company.orsquare_feature_tables:
            patches['tables'] = self.env['orsquare.tab.service'].table_status()
        if 'settings_changed' in types:
            patches['me'] = self.env['orsquare.staff.service'].me()
        if since_ts:
            # Odoo stamps write_date with the transaction START time, so a slow transaction can commit a
            # change older than the client's last timestamp. Re-send a small overlap window; clients upsert
            # by id, so duplicates are harmless and nothing is ever missed.
            overlap = fields.Datetime.to_string(fields.Datetime.to_datetime(since_ts) - timedelta(seconds=OVERLAP_SECONDS))
            changed = self.env['orsquare.catalog.service'].list_products(changed_since=overlap, limit=5000)
            if changed:
                patches['products'] = changed
        if types & {'payment_recorded', 'sale_settled', 'purchase_recorded', 'purchase_returned'}:
            patches['customers'] = self.env['orsquare.accounts.service'].directory('customers', limit=1000)['rows']
            patches['suppliers'] = self.env['orsquare.accounts.service'].directory('suppliers', limit=1000)['rows']
        return {
            'seq': events[-1]['seq'] if events else since_seq, 'events': events, 'patches': patches,
            'has_more': len(events) >= limit, 'server_ts': fields.Datetime.to_string(fields.Datetime.now()),
        }

    # ------------------------------------------------------------------ flush
    @api.model
    def flush(self, mutations):
        """Apply the offline outbox. Returns one result per mutation, in order."""
        if not (self.env.su or self.env.user.has_group('orsquare.group_orsquare_cashier')
                or self.env.user.has_group('orsquare.group_orsquare_stockkeeper')):
            raise AccessError(_("You are not allowed to sync."))
        env = self.env
        Log = env['orsquare.sync_log'].sudo()
        company = env.company
        results = []
        # group by device, strictly by sequence
        by_device = {}
        for m in mutations or []:
            by_device.setdefault(m['device_id'], []).append(m)
        out = {}
        for device_id, items in by_device.items():
            items.sort(key=lambda m: int(m['device_seq']))
            blocked = False
            for m in items:
                out[m['id']] = self._apply_one(env, Log, company, m, blocked_state=blocked)
                if out[m['id']]['status'] == 'out_of_order':
                    blocked = True
        for m in mutations or []:
            results.append(dict(out[m['id']], id=m['id']))
        return {'results': results, 'seq': env['orsquare.event'].latest_seq(company)}

    @api.model
    def _apply_one(self, env, Log, company, m, blocked_state):
        mid, device, seq, kind = str(m['id']), str(m['device_id']), int(m['device_seq']), m.get('kind')
        # 1. replay -> stored answer, never re-executed
        done = Log.search([('mutation_id', '=', mid), ('company_id', '=', company.id)], limit=1)
        if done:
            return {'status': 'duplicate', 'applied_status': done.status, 'result': done.result,
                    'error': {'code': done.error_code, 'message': done.error_message} if done.status == 'error' else None}
        if blocked_state:
            return {'status': 'out_of_order', 'error': {'code': 'out_of_order', 'message': 'An earlier mutation is missing.'}}
        # 2. ordering: exactly last + 1
        env.cr.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", ['sync:' + device])
        last = Log.search([('device_id', '=', device), ('company_id', '=', company.id)], order='device_seq desc', limit=1)
        expected = (last.device_seq if last else 0) + 1
        if seq != expected:
            return {'status': 'out_of_order', 'expected_seq': expected,
                    'error': {'code': 'out_of_order', 'message': 'Expected sequence %s, got %s.' % (expected, seq)}}
        if kind not in self.MUTATIONS:
            Log.create({'mutation_id': mid, 'device_id': device, 'device_seq': seq, 'kind': str(kind),
                        'status': 'error', 'error_code': 'not_allowed_offline',
                        'error_message': _("'%s' cannot be applied from the offline queue.", kind)})
            return {'status': 'error', 'error': {'code': 'not_allowed_offline',
                                                 'message': "'%s' cannot be applied from the offline queue." % kind}}
        model, method = self.MUTATIONS[kind]
        payload = dict(m.get('payload') or {})
        if kind == 'sale':
            payload.setdefault('client_ref', mid)
            payload['offline'] = True
            payload.setdefault('created_at', m.get('created_at'))
        elif kind == 'purchase':
            payload.setdefault('client_ref', mid)
        # 3. execute in a savepoint: a business error never blocks the rest of the batch
        try:
            with env.cr.savepoint():
                result = getattr(env[model], method)(payload) if kind in ('sale', 'purchase') \
                    else self._call(env, model, method, payload)
                Log.create({'mutation_id': mid, 'device_id': device, 'device_seq': seq, 'kind': kind,
                            'status': 'ok', 'result': self._jsonable(result)})
            return {'status': 'ok', 'result': self._jsonable(result)}
        except (UserError, ValidationError, AccessError, RedirectWarning) as exc:
            code = 'access_denied' if isinstance(exc, AccessError) else 'rejected'
            message = exc.args[0] if exc.args else str(exc)
        except Exception as exc:  # unexpected: still advance the cursor, never loop forever
            _logger.exception("Offline mutation %s failed", mid)
            code, message = 'server_error', str(exc)
        Log.create({'mutation_id': mid, 'device_id': device, 'device_seq': seq, 'kind': kind,
                    'status': 'error', 'error_code': code, 'error_message': message})
        return {'status': 'error', 'error': {'code': code, 'message': message}}

    @api.model
    def _call(self, env, model, method, payload):
        if method == 'manual_transfer_api':
            wh = env['stock.warehouse'].orsquare_main_warehouse(env.company)
            picking = env['orsquare.stock.service'].manual_transfer(
                wh, payload['direction'], {int(k): float(v) for k, v in payload['quantities'].items()},
                origin=payload.get('origin'))
            env['orsquare.event'].publish(env.company, 'stock_changed', {'products': [int(k) for k in payload['quantities']]})
            return {'picking': picking.name}
        if method == 'open_bottle_api':
            product = env['product.product'].browse(int(payload['product_id']))
            bottle = env['orsquare.opened_bottle'].open_bottle(product, note=payload.get('note'))
            return {'bottle_id': bottle.id, 'label': bottle.name}
        if method == 'finish_bottle_api':
            bottle = env['orsquare.opened_bottle'].browse(int(payload['bottle_id']))
            bottle.action_finish(reason=payload.get('reason'))
            return {'bottle_id': bottle.id, 'state': bottle.state}
        svc = env[model]
        if method == 'new_entry':
            return {'payment_id': svc.new_entry(payload['kind'], payload['amount'], payload.get('mode', 'cash'),
                                                payload.get('description'))}
        if method == 'receive_payment':
            return {'payment_id': svc.receive_payment(payload['partner_id'], payload['amount'],
                                                      payload.get('method', 'cash'), payload.get('note'))}
        raise UserError(_("Unsupported mutation."))

    @staticmethod
    def _jsonable(value):
        import json
        return json.loads(json.dumps(value, default=str))
