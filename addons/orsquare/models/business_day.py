# -*- coding: utf-8 -*-
"""Daybook: the operational business day (open -> sealed -> re_audited).

A business day wraps one native ``pos.session`` (cash control, opening float, closing count,
cash-difference postings all remain Odoo's).  Sealing freezes a read-optimised snapshot (the
"Z-report"); re-auditing recomputes it, including later-dated adjustments (returns, credit notes)
that point back at this day, and records an immutable log entry.
"""
import logging
from collections import defaultdict

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.tools import float_compare, float_round

_logger = logging.getLogger(__name__)


class OrsquareBusinessDay(models.Model):
    _name = 'orsquare.business_day'
    _description = "ORSquare Business Day (Daybook)"
    _order = 'date desc'

    name = fields.Char(compute='_compute_name', store=True)
    company_id = fields.Many2one('res.company', required=True, default=lambda s: s.env.company, index=True)
    currency_id = fields.Many2one(related='company_id.currency_id')
    date = fields.Date(string="Business Date", required=True, index=True)
    state = fields.Selection(
        [('open', 'Open'), ('sealed', 'Sealed'), ('re_audited', 'Re-audited')],
        default='open', required=True, index=True, copy=False)
    session_id = fields.Many2one('pos.session', string="POS Session", copy=False, ondelete='restrict')
    auto_opened = fields.Boolean(help="Opened implicitly by the first sale of the day (no counted float).")

    opening_float = fields.Monetary(currency_field='currency_id')
    counted_cash = fields.Monetary(currency_field='currency_id', copy=False)
    expected_cash = fields.Monetary(currency_field='currency_id', copy=False,
                                    help="Frozen at sealing. While open use live_expected_cash().")
    cash_variance = fields.Monetary(currency_field='currency_id', copy=False)
    variance_note = fields.Text(copy=False)

    snapshot = fields.Json(copy=False, help="Frozen Z-report figures. Immutable once sealed.")
    sealed_at = fields.Datetime(copy=False, readonly=True)
    sealed_by = fields.Many2one('res.users', copy=False, readonly=True)
    audit_log_ids = fields.One2many('orsquare.day_audit_log', 'business_day_id', string="Re-audit Log")

    _sql_constraints = [
        ('company_date_unique', 'unique(company_id, date)', "There is only one business day per date."),
    ]

    @api.depends('date')
    def _compute_name(self):
        for day in self:
            day.name = _("Business Day %s", day.date) if day.date else _("Business Day")

    # ------------------------------------------------------------------ guards
    @api.model
    def check_day_not_sealed(self, company, date):
        day = self.search([('company_id', '=', company.id), ('date', '=', date),
                           ('state', 'in', ('sealed', 're_audited'))], limit=1)
        if day:
            raise UserError(_(
                "Business day %s is sealed. Sales, purchases and vouchers can no longer be "
                "recorded on it; post an adjustment on the current day instead.", date))

    @api.model
    def get_open_day(self, company=None):
        company = company or self.env.company
        return self.search([('company_id', '=', company.id), ('state', '=', 'open')], order='date', limit=1)

    # ------------------------------------------------------------------ opening
    @api.model
    def open_day(self, opening_float=0.0, note=None, company=None, auto=False, date=None):
        """Open the daybook for the current business date (idempotent)."""
        company = (company or self.env.company)
        self = self.sudo()
        date = date or company.orsquare_current_business_date()
        day = self.search([('company_id', '=', company.id), ('date', '=', date)], limit=1)
        if day:
            if day.state != 'open':
                raise UserError(_("Business day %s is already sealed.", date))
            return day
        stale = self.search([('company_id', '=', company.id), ('state', '=', 'open'), ('date', '<', date)],
                            order='date', limit=1)
        if stale:
            raise UserError(_(
                "Business day %s is still open. Count the drawer and seal it before opening %s.",
                stale.date, date))
        config = self.env['orsquare.shop.bootstrap'].pos_config(company)
        session = self.env['pos.session'].with_company(company).create({
            'config_id': config.id, 'user_id': self.env.uid})
        session.set_opening_control(opening_float, note or '')
        return self.create({
            'company_id': company.id, 'date': date, 'session_id': session.id,
            'opening_float': opening_float, 'auto_opened': auto,
        })

    @api.model
    def ensure_open_day(self, company, date):
        """Day used by a sale dated ``date``: must exist (auto-opened if it is today) and be open."""
        day = self.sudo().search([('company_id', '=', company.id), ('date', '=', date)], limit=1)
        if day:
            if day.state != 'open':
                raise UserError(_("Business day %s is sealed; the sale cannot be recorded on it.", date))
            return day
        if date == company.orsquare_current_business_date():
            return self.open_day(0.0, _("Opened automatically by the first sale"), company, auto=True)
        raise UserError(_("No daybook was opened for business date %s.", date))

    # ------------------------------------------------------------------ cash
    def _external_cash_net(self):
        """Cash that moved through the drawer outside POS (Khata receipts, supplier payments)."""
        self.ensure_one()
        session = self.session_id
        cash_journal = session.cash_journal_id
        if not cash_journal:
            return 0.0
        payments = self.env['account.payment'].sudo().search([
            ('company_id', '=', self.company_id.id), ('journal_id', '=', cash_journal.id),
            ('orsquare_business_date', '=', self.date), ('state', 'in', ('in_process', 'paid')),
            ('pos_session_id', '=', False)])
        net = 0.0
        for pay in payments:
            net += pay.amount if pay.payment_type == 'inbound' else -pay.amount
        return net

    def live_expected_cash(self):
        """Expected drawer cash = opening float + net cash sales + cash in/out (native)
        + customer cash receipts - supplier cash payments (outside POS)."""
        self.ensure_one()
        if self.state != 'open':
            return self.expected_cash
        session = self.session_id
        session.invalidate_recordset(['cash_register_balance_end', 'cash_register_difference'])
        expected = session.cash_register_balance_end + self._external_cash_net()
        # cash_register_difference is a cached compute that does not depend on the counted cash:
        # never leave the value computed against an empty count behind.
        session.invalidate_recordset(['cash_register_balance_end', 'cash_register_difference'])
        return expected

    # ------------------------------------------------------------------ snapshot
    def _day_orders(self):
        return self.env['pos.order'].sudo().search([
            ('company_id', '=', self.company_id.id), ('orsquare_business_date', '=', self.date),
            ('state', 'in', ('paid', 'done', 'invoiced'))])

    def _compute_snapshot(self):
        self.ensure_one()
        orders = self._day_orders()
        cur = self.currency_id
        gross = sum(o.amount_total for o in orders if o.amount_total > 0)
        refunds = sum(o.amount_total for o in orders if o.amount_total < 0)
        by_method = defaultdict(float)
        for pay in orders.payment_ids:
            method = pay.payment_method_id
            if method.orsquare_is_concession:
                key = 'concession'
            elif method.is_cash_count:
                key = 'cash'
            elif method.type == 'pay_later':
                key = 'khata'
            else:
                key = 'upi'
            by_method[key] += pay.amount
        revenue_ex_tax = sum(l.price_subtotal for l in orders.lines)
        cogs = sum(l.total_cost for l in orders.lines)
        retail = sum(l.price_subtotal_incl for l in orders.lines if not l.product_id.is_kitchen)
        kitchen = sum(l.price_subtotal_incl for l in orders.lines if l.product_id.is_kitchen)
        top = defaultdict(lambda: [0.0, 0.0])
        for line in orders.lines:
            row = top[line.product_id.display_name]
            row[0] += line.qty
            row[1] += line.price_subtotal_incl
        top_skus = sorted(([n, round(v[0], 6), round(v[1], 2)] for n, v in top.items()),
                          key=lambda r: -r[2])[:10]
        hourly = defaultdict(float)
        import zoneinfo
        from datetime import timezone
        tz = zoneinfo.ZoneInfo(self.company_id.orsquare_tz)
        for o in orders:
            local = o.date_order.replace(tzinfo=timezone.utc).astimezone(tz)
            hourly['%02d' % local.hour] += o.amount_total
        # Adjustments dated on later days that point back at this day's documents.
        adjustments = self._linked_adjustments(orders)
        return {
            'bill_count': len(orders.filtered(lambda o: o.amount_total > 0)),
            'gross_sales': float_round(gross, precision_rounding=cur.rounding),
            'refunds': float_round(refunds, precision_rounding=cur.rounding),
            'net_sales': float_round(gross + refunds, precision_rounding=cur.rounding),
            'tax_total': float_round(sum(o.amount_tax for o in orders), precision_rounding=cur.rounding),
            'revenue_ex_tax': float_round(revenue_ex_tax, precision_rounding=cur.rounding),
            'cogs': float_round(cogs, precision_rounding=cur.rounding),
            'gross_profit': float_round(revenue_ex_tax - cogs, precision_rounding=cur.rounding),
            'cash_sales': float_round(by_method['cash'], precision_rounding=cur.rounding),
            'upi_sales': float_round(by_method['upi'], precision_rounding=cur.rounding),
            'khata_sales': float_round(by_method['khata'], precision_rounding=cur.rounding),
            'concessions': float_round(by_method['concession'], precision_rounding=cur.rounding),
            'retail_sales': float_round(retail, precision_rounding=cur.rounding),
            'kitchen_sales': float_round(kitchen, precision_rounding=cur.rounding),
            'top_skus': top_skus,
            'hourly_sales': {k: float_round(v, precision_rounding=cur.rounding) for k, v in sorted(hourly.items())},
            'adjustments_total': float_round(adjustments, precision_rounding=cur.rounding),
            'adjusted_net_sales': float_round(gross + refunds + adjustments, precision_rounding=cur.rounding),
        }

    def _linked_adjustments(self, orders):
        """Refund orders / credit notes dated on other days that reverse this day's sales."""
        refund_lines = self.env['pos.order.line'].sudo().search([
            ('refunded_orderline_id.order_id', 'in', orders.ids)])
        refunds = refund_lines.mapped('order_id').filtered(
            lambda o: o.orsquare_business_date != self.date and o.state in ('paid', 'done', 'invoiced'))
        total = sum(refunds.mapped('amount_total'))
        invoices = orders.account_move
        credit_notes = self.env['account.move'].sudo().search([
            ('reversed_entry_id', 'in', invoices.ids), ('move_type', '=', 'out_refund'),
            ('state', '=', 'posted'), ('orsquare_business_date', '!=', self.date),
            ('pos_order_ids', '=', False)])
        total -= sum(credit_notes.mapped('amount_total'))
        return total

    # ------------------------------------------------------------------ sealing
    def action_seal(self, counted_cash, note=None):
        self.ensure_one()
        self = self.sudo()
        if self.state != 'open':
            raise UserError(_("Business day %s is not open.", self.date))
        company = self.company_id
        session = self.session_id
        if session.get_session_orders().filtered(lambda o: o.state == 'draft'):
            raise UserError(_("Settle or cancel all draft bills before closing the day."))
        expected = self.live_expected_cash()
        variance = float_round(counted_cash - expected, precision_rounding=self.currency_id.rounding)
        threshold = company.orsquare_cash_materiality
        if float_compare(abs(variance), threshold, precision_rounding=self.currency_id.rounding) > 0 \
                and not (note or '').strip():
            raise UserError(_(
                "The drawer is %(var)s off (tolerance is %(tol)s). Enter a reason to close the day.",
                var=variance, tol=threshold))
        external = self._external_cash_net()
        res = session.post_closing_cash_details(counted_cash - external)
        if not res.get('successful'):
            raise UserError(res.get('message') or _("The POS session could not be closed."))
        session.invalidate_recordset(['cash_register_balance_end', 'cash_register_difference'])
        session.update_closing_control_state_session(note or '')
        res = session.close_session_from_ui([])
        if not res.get('successful'):
            raise UserError(res.get('message') or _("The POS session could not be closed."))
        snapshot = self._compute_snapshot()
        self.with_context(orsquare_allow_sealed=True).write({
            'state': 'sealed', 'counted_cash': counted_cash, 'expected_cash': expected,
            'cash_variance': variance, 'variance_note': note or False,
            'snapshot': snapshot, 'sealed_at': fields.Datetime.now(), 'sealed_by': self.env.uid,
        })
        self.env['orsquare.event'].publish(company, 'day_sealed', {'date': str(self.date)})
        return True

    def action_reaudit(self, reason):
        """Recompute a sealed day's figures (incl. linked adjustments) with an immutable log entry."""
        self.ensure_one()
        if not self.env.user.has_group('orsquare.group_orsquare_owner') and not self.env.su:
            raise AccessError(_("Only the shop owner can re-audit a business day."))
        if self.state not in ('sealed', 're_audited'):
            raise UserError(_("Only sealed days can be re-audited."))
        if not (reason or '').strip():
            raise UserError(_("A reason is required to re-audit a business day."))
        previous = dict(self.snapshot or {})
        new = self._compute_snapshot()
        self.env['orsquare.day_audit_log'].sudo().create({
            'business_day_id': self.id, 'user_id': self.env.uid, 'reason': reason,
            'previous_snapshot': previous, 'new_snapshot': new,
        })
        self.sudo().write({'snapshot': new, 'state': 're_audited'})
        return new

    def write(self, vals):
        for day in self:
            if day.state in ('sealed', 're_audited') and not self.env.context.get('orsquare_allow_sealed') \
                    and set(vals) - {'state', 'snapshot'}:
                raise UserError(_("A sealed business day cannot be edited."))
        if 'snapshot' in vals and not self.env.context.get('orsquare_allow_sealed'):
            if any(d.state == 'sealed' for d in self) and 'state' not in vals:
                raise UserError(_("A sealed business day's snapshot is immutable; use re-audit."))
        return super().write(vals)

    def unlink(self):
        for day in self:
            if day.state != 'open' and not self.env.context.get('orsquare_wipe'):
                raise UserError(_("Sealed business days cannot be deleted."))
        return super().unlink()

    # ------------------------------------------------------------------ read API
    def summary(self):
        """Figures for the Daybook / Calendar screens. Frozen when sealed, live when open."""
        self.ensure_one()
        data = self.snapshot if self.state != 'open' else self._compute_snapshot()
        return {
            'id': self.id, 'date': str(self.date), 'state': self.state,
            'opening_float': self.opening_float,
            'expected_cash': self.live_expected_cash(),
            'counted_cash': self.counted_cash, 'cash_variance': self.cash_variance,
            'figures': data,
        }


class OrsquareDayAuditLog(models.Model):
    _name = 'orsquare.day_audit_log'
    _description = "Business Day Re-audit Log (immutable)"
    _order = 'id desc'

    business_day_id = fields.Many2one('orsquare.business_day', required=True, ondelete='cascade', index=True)
    user_id = fields.Many2one('res.users', required=True, readonly=True)
    reason = fields.Text(required=True, readonly=True)
    previous_snapshot = fields.Json(readonly=True)
    new_snapshot = fields.Json(readonly=True)

    def write(self, vals):
        raise UserError(_("Audit log entries are immutable."))

    def unlink(self):
        if not self.env.context.get('orsquare_wipe'):
            raise UserError(_("Audit log entries are immutable."))
        return super().unlink()
