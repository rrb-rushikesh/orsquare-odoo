# -*- coding: utf-8 -*-
"""Dashboard, Calendar and Ledger projections.

Everything here is a read-only projection of Odoo accounting / inventory (and frozen business-day
snapshots).  No number is derived by client logic and nothing is written.
"""
from datetime import timedelta

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError
from odoo.tools import float_round

from .security_utils import require_staff

REVENUE_TYPES = ('income', 'income_other')
COGS_TYPES = ('expense_direct_cost',)
EXPENSE_TYPES = ('expense', 'expense_depreciation')
ASSET_TYPES = ('asset_receivable', 'asset_cash', 'asset_current', 'asset_non_current', 'asset_prepayments', 'asset_fixed')
LIABILITY_TYPES = ('liability_payable', 'liability_credit_card', 'liability_current', 'liability_non_current')
STOCK_ACCOUNT_CODES = ('100901', '100902', '100903')


class OrsquareReportsService(models.AbstractModel):
    _name = 'orsquare.reports.service'
    _description = "ORSquare Dashboard & Ledger Reports"

    # ------------------------------------------------------------------ permissions
    @api.model
    def _money(self):
        return self.env.su or self.env.user.has_group('orsquare.group_orsquare_can_see_money')

    @api.model
    def _valuation(self):
        return self.env.su or self.env.user.has_group('orsquare.group_orsquare_can_see_valuation')

    # ------------------------------------------------------------------ dashboard
    @api.model
    def dashboard(self):
        require_staff(self.env)
        env = self.sudo().env
        company = self.env.company
        today = company.orsquare_current_business_date()
        Day = env['orsquare.business_day']
        day = Day.search([('company_id', '=', company.id), ('date', '=', today)], limit=1)
        money, valuation = self._money(), self._valuation()
        figures = {}
        if day:
            figures = day._compute_snapshot() if day.state == 'open' else (day.snapshot or {})
        card = {
            'business_date': str(today), 'day_state': day.state if day else 'not_opened',
            'bill_count': figures.get('bill_count', 0),
            'total_sales': figures.get('net_sales', 0.0) if money else None,
            'gross_sales': figures.get('gross_sales', 0.0) if money else None,
            'payments': {
                'cash': figures.get('cash_sales', 0.0), 'upi': figures.get('upi_sales', 0.0),
                'khata': figures.get('khata_sales', 0.0)} if money else None,
            'gross_profit': figures.get('gross_profit', 0.0) if (money and valuation) else None,
            'drawer_cash': day.live_expected_cash() if (day and money) else None,
        }
        # 7-day trend: sealed days from frozen snapshots, today live
        trend = []
        for i in range(6, -1, -1):
            d = today - timedelta(days=i)
            rec = Day.search([('company_id', '=', company.id), ('date', '=', d)], limit=1)
            if not rec:
                value = 0.0
            elif rec.state == 'open':
                value = figures.get('net_sales', 0.0)
            else:
                value = (rec.snapshot or {}).get('net_sales', 0.0)
            trend.append({'date': str(d), 'sales': value if money else None})
        return {
            'today': card, 'trend': trend,
            'stock_value': self.env['orsquare.stock.reports'].stock_value_by_location(),
            'attention': self._attention(env, company, day),
            'quick_actions': ['new_sale', 'record_purchase', 'transfer_stock', 'new_entry'],
            'retailer_summary': self._retailer_summary(env, company, today, figures, trend),
        }

    @api.model
    def _retailer_summary(self, env, company, today, figures, trend):
        """Read projection for the original retailer cards, using native documents only."""
        summary = {'dayKey': str(today), 'monthKey': str(today)[:7], 'weekKey': str(today),
                   'todayBills': figures.get('bill_count', 0)}
        if not self._money():
            return summary
        month_start = today.replace(day=1)
        days = env['orsquare.business_day'].search([
            ('company_id', '=', company.id), ('date', '>=', month_start), ('date', '<=', today)])
        snapshots = [d._compute_snapshot() if d.state == 'open' else (d.snapshot or {}) for d in days]
        yesterday = env['orsquare.business_day'].search([
            ('company_id', '=', company.id), ('date', '=', today - timedelta(days=1))], limit=1)
        previous = (yesterday._compute_snapshot() if yesterday.state == 'open' else yesterday.snapshot or {}) if yesterday else {}
        cashflow = self.env['orsquare.cashflow.service']
        daily_cash = cashflow.register(str(today), str(today))
        month_cash = cashflow.register(str(month_start), str(today))
        bills = env['account.move'].search([
            ('company_id', '=', company.id), ('state', '=', 'posted'), ('move_type', '=', 'in_invoice'),
            ('orsquare_business_date', '>=', month_start), ('orsquare_business_date', '<=', today)])
        parties = self.env['orsquare.accounts.service'].directory(limit=1)['summary']
        summary.update({
            'todayTotal': figures.get('net_sales', 0.0), 'yestTotal': previous.get('net_sales', 0.0),
            'yestBills': previous.get('bill_count', 0), 'monthTotal': sum(s.get('net_sales', 0.0) for s in snapshots),
            'cashToday': figures.get('cash_sales', 0.0), 'upiToday': figures.get('upi_sales', 0.0),
            'khataToday': figures.get('khata_sales', 0.0),
            'retailTodaySales': figures.get('retail_sales', 0.0), 'kitchenTodaySales': figures.get('kitchen_sales', 0.0),
            'monthCash': sum(s.get('cash_sales', 0.0) for s in snapshots),
            'monthUpi': sum(s.get('upi_sales', 0.0) for s in snapshots),
            'monthPurchases': sum(bills.mapped('amount_total')),
            'cashInToday': daily_cash['cash_in'], 'cashOutToday': daily_cash['cash_out'],
            'monthCashOut': month_cash['cash_out'], 'receivables': parties['receivables'], 'payables': parties['payables'],
            'weekDaily': [{'date': r['date'], 'total': r['sales']} for r in trend],
        })
        if self._valuation():
            # POS revenue/COGS is posted at session close. Use the native live/frozen day
            # figures for trading profit and posted non-trading accounts for other activity.
            daily_pl = self.profit_and_loss(str(today), str(today))
            month_pl = self.profit_and_loss(str(month_start), str(today))
            extra_today = sum(r['amount'] for r in daily_pl['revenue'] if r['type'] == 'income_other')
            extra_month = sum(r['amount'] for r in month_pl['revenue'] if r['type'] == 'income_other')
            summary['todayNetProfit'] = figures.get('gross_profit', 0.0) + extra_today - daily_pl['total_expenses']
            summary['monthNetProfit'] = sum(s.get('gross_profit', 0.0) for s in snapshots) + extra_month - month_pl['total_expenses']
        return summary

    @api.model
    def _attention(self, env, company, day):
        items = []
        for row in self.env['orsquare.stock.reports'].needs_attention_stock()[:20]:
            items.append({'type': 'low_stock', 'product': row['name'], 'total': row['total']})
        if self._money():
            cutoff = fields.Date.context_today(self) - timedelta(days=company.orsquare_khata_overdue_days)
            lines = env['account.move.line'].search([
                ('company_id', '=', company.id), ('parent_state', '=', 'posted'), ('reconciled', '=', False),
                ('account_id.account_type', '=', 'asset_receivable'), ('balance', '>', 0),
                ('date', '<=', cutoff), ('partner_id', '!=', False)])
            overdue = {}
            for l in lines:
                overdue[l.partner_id] = overdue.get(l.partner_id, 0.0) + l.amount_residual
            for partner, amount in sorted(overdue.items(), key=lambda kv: -kv[1])[:20]:
                items.append({'type': 'overdue_khata', 'partner_id': partner.id, 'partner': partner.name, 'amount': amount})
        open_disc = env['orsquare.stock_discrepancy'].search_count([('state', '=', 'open'), ('company_id', '=', company.id)])
        if open_disc:
            items.append({'type': 'stock_discrepancy', 'count': open_disc})
        stale = env['orsquare.business_day'].search([('company_id', '=', company.id), ('state', '=', 'open'),
                                                     ('date', '<', company.orsquare_current_business_date())], limit=1)
        if stale:
            items.append({'type': 'unclosed_day', 'date': str(stale.date)})
        return items

    # ------------------------------------------------------------------ calendar
    @api.model
    def calendar(self, date_from, date_to):
        """Period summary from frozen snapshots (max 92 days)."""
        require_staff(self.env)
        date_from, date_to = fields.Date.to_date(date_from), fields.Date.to_date(date_to)
        if (date_to - date_from).days > 92:
            raise UserError(_("A period can span at most 92 days."))
        env = self.sudo().env
        days = env['orsquare.business_day'].search([
            ('company_id', '=', self.env.company.id), ('date', '>=', date_from), ('date', '<=', date_to)], order='date')
        money = self._money()
        rows, totals = [], {}
        for d in days:
            fig = d.snapshot if d.state != 'open' else d._compute_snapshot()
            rows.append({'date': str(d.date), 'state': d.state, 'figures': fig if money else {
                k: v for k, v in (fig or {}).items() if k in ('bill_count',)}})
            for k in ('gross_sales', 'refunds', 'net_sales', 'cash_sales', 'upi_sales', 'khata_sales', 'bill_count'):
                totals[k] = totals.get(k, 0) + (fig or {}).get(k, 0)
        return {'days': rows, 'totals': totals if money else {}}

    @api.model
    def day_detail(self, date):
        require_staff(self.env)
        d = self.sudo().env['orsquare.business_day'].search([
            ('company_id', '=', self.env.company.id), ('date', '=', fields.Date.to_date(date))], limit=1)
        if not d:
            raise UserError(_("No business day on %s.", date))
        data = d.summary()
        if not self._money():
            data['figures'] = {k: v for k, v in data['figures'].items() if k == 'bill_count'}
            data['expected_cash'] = data['counted_cash'] = data['cash_variance'] = None
        return data

    # ------------------------------------------------------------------ ledger
    @api.model
    def _require_ledger(self):
        if not (self.env.su or self.env.user.has_group('orsquare.group_orsquare_can_see_money')):
            raise AccessError(_("Ledger reports are hidden for your role."))

    @api.model
    def _grouped(self, date_from=None, date_to=None, before=False):
        env = self.sudo().env
        domain = [('company_id', '=', self.env.company.id), ('parent_state', '=', 'posted')]
        if before and date_from:
            domain.append(('date', '<', date_from))
        else:
            if date_from:
                domain.append(('date', '>=', date_from))
            if date_to:
                domain.append(('date', '<=', date_to))
        out = {}
        for account, debit, credit in env['account.move.line']._read_group(
                domain, ['account_id'], ['debit:sum', 'credit:sum']):
            out[account] = (debit, credit)
        return out

    @api.model
    def trial_balance(self, date_from=None, date_to=None):
        self._require_ledger()
        prior = self._grouped(date_from, before=True) if date_from else {}
        period = self._grouped(date_from, date_to)
        rows, td, tc = [], 0.0, 0.0
        for acc in sorted(set(prior) | set(period), key=lambda a: a.code or ''):
            if not self._valuation() and acc.code in STOCK_ACCOUNT_CODES:
                continue
            od, oc = prior.get(acc, (0.0, 0.0))
            pd, pc = period.get(acc, (0.0, 0.0))
            rows.append({'code': acc.code, 'name': acc.name, 'opening': od - oc, 'debit': pd, 'credit': pc,
                         'closing': od - oc + pd - pc})
            td += pd
            tc += pc
        return {'rows': rows, 'total_debit': td, 'total_credit': tc,
                'balanced': round(td - tc, 2) == 0.0 or not self._valuation()}

    @api.model
    def profit_and_loss(self, date_from=None, date_to=None):
        self._require_ledger()
        grouped = self._grouped(date_from, date_to)
        sections = {'revenue': [], 'cogs': [], 'expenses': []}
        for acc, (d, c) in grouped.items():
            t = acc.account_type
            if t in REVENUE_TYPES:
                sections['revenue'].append({'code': acc.code, 'name': acc.name, 'amount': c - d, 'type': t})
            elif t in COGS_TYPES:
                sections['cogs'].append({'code': acc.code, 'name': acc.name, 'amount': d - c})
            elif t in EXPENSE_TYPES:
                sections['expenses'].append({'code': acc.code, 'name': acc.name, 'amount': d - c})
        revenue = sum(r['amount'] for r in sections['revenue'])
        cogs = sum(r['amount'] for r in sections['cogs'])
        expenses = sum(r['amount'] for r in sections['expenses'])
        res = {'revenue': sections['revenue'], 'total_revenue': revenue, 'expenses': sections['expenses'],
               'total_expenses': expenses, 'total_operating_cost': expenses + cogs if self._valuation() else None}
        if self._valuation():
            res.update({'cogs': sections['cogs'], 'total_cogs': cogs, 'gross_profit': revenue - cogs,
                        'net_profit': revenue - cogs - expenses})
        else:
            res['net_profit'] = None
        return res

    @api.model
    def balance_sheet(self, as_of=None):
        self._require_ledger()
        grouped = self._grouped(None, as_of)
        assets, liabilities, equity = [], [], []
        earnings = 0.0
        for acc, (d, c) in grouped.items():
            t = acc.account_type
            if not self._valuation() and acc.code in STOCK_ACCOUNT_CODES:
                continue
            if t in ASSET_TYPES:
                assets.append({'code': acc.code, 'name': acc.name, 'amount': d - c})
            elif t in LIABILITY_TYPES:
                liabilities.append({'code': acc.code, 'name': acc.name, 'amount': c - d})
            elif t == 'equity' or t == 'equity_unaffected':
                equity.append({'code': acc.code, 'name': acc.name, 'amount': c - d})
            elif t in REVENUE_TYPES:
                earnings += c - d
            elif t in COGS_TYPES + EXPENSE_TYPES:
                earnings -= d - c
        equity.append({'code': '', 'name': _("Current period earnings"), 'amount': earnings})
        total_a = sum(r['amount'] for r in assets)
        total_l = sum(r['amount'] for r in liabilities)
        total_e = sum(r['amount'] for r in equity)
        return {'assets': assets, 'liabilities': liabilities, 'equity': equity,
                'total_assets': total_a, 'total_liabilities': total_l, 'total_equity': total_e,
                'total_liabilities_and_equity': total_l + total_e,
                'balanced': round(total_a - total_l - total_e, 2) == 0.0 or not self._valuation()}

    @api.model
    def gst_report(self, date_from=None, date_to=None):
        """Output tax vs input tax credit by tax; liquor State VAT stays in its own bucket.

        Classified by the ledger account the tax posts to (liability = collected, asset = credit):
        Odoo splits GST into child taxes whose own type is 'none', so the tax type cannot be trusted.
        """
        self._require_ledger()
        env = self.sudo().env
        company = self.env.company
        domain = [('company_id', '=', company.id), ('parent_state', '=', 'posted'), ('tax_line_id', '!=', False)]
        if date_from:
            domain.append(('date', '>=', date_from))
        if date_to:
            domain.append(('date', '<=', date_to))
        regimes = env['orsquare.tax_regime'].search([('company_id', '=', company.id), ('kind', '=', 'liquor')])
        levy_taxes = regimes.sale_tax_ids | regimes.purchase_tax_ids
        out, inp, levies = {}, {}, {}
        for tax, account, d, c in env['account.move.line']._read_group(
                domain, ['tax_line_id', 'account_id'], ['debit:sum', 'credit:sum']):
            if tax in levy_taxes:
                levies[tax.name] = levies.get(tax.name, 0.0) + (c - d)
            elif account.account_type.startswith('liability'):
                out[tax.name] = out.get(tax.name, 0.0) + (c - d)
            else:
                inp[tax.name] = inp.get(tax.name, 0.0) + (d - c)
        total_out, total_in = sum(out.values()), sum(inp.values())
        return {'output': out, 'input_credit': inp, 'state_levies': levies,
                'total_output': total_out, 'total_input_credit': total_in,
                'net_payable': total_out - total_in, 'total_state_levies': sum(levies.values())}

    @api.model
    def registers(self, kind, date_from=None, date_to=None, limit=500):
        """Sales register (customer invoices + counter bills) or purchase register (vendor bills)."""
        self._require_ledger()
        env = self.sudo().env
        company = self.env.company
        rows = []
        if kind == 'purchases':
            domain = [('company_id', '=', company.id), ('move_type', 'in', ('in_invoice', 'in_refund')),
                      ('state', '=', 'posted')]
            if date_from:
                domain.append(('orsquare_business_date', '>=', date_from))
            if date_to:
                domain.append(('orsquare_business_date', '<=', date_to))
            for m in env['account.move'].search(domain, order='invoice_date desc, id desc', limit=limit):
                rows.append({'date': str(m.orsquare_business_date), 'number': m.name, 'party': m.partner_id.name,
                             'ref': m.ref or '', 'untaxed': m.amount_untaxed, 'tax': m.amount_tax, 'total': m.amount_total,
                             'type': m.move_type})
        else:
            domain = [('company_id', '=', company.id), ('state', 'in', ('paid', 'done', 'invoiced'))]
            if date_from:
                domain.append(('orsquare_business_date', '>=', date_from))
            if date_to:
                domain.append(('orsquare_business_date', '<=', date_to))
            for o in env['pos.order'].search(domain, order='date_order desc, id desc', limit=limit):
                rows.append({'date': str(o.orsquare_business_date), 'number': o.account_move.name or o.name,
                             'party': o.partner_id.name or '', 'untaxed': o.amount_total - o.amount_tax,
                             'tax': o.amount_tax, 'total': o.amount_total,
                             'type': 'invoice' if o.account_move else 'counter'})
        return {'rows': rows}
