# -*- coding: utf-8 -*-
"""Cash Flow tab: the chronological cash diary over Odoo's own cash/bank ledger lines."""
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError
from odoo.tools import float_round


class OrsquareCashflowService(models.AbstractModel):
    _name = 'orsquare.cashflow.service'
    _description = "ORSquare Cash Flow Service"

    VOUCHERS = {
        # kind: (payment_type, account key or chart code, label)
        'expense': ('outbound', 'petty_expense', "Expense"),
        'income': ('inbound', 'misc_income', "Income"),
        'owner_drawing': ('outbound', 'owner_drawings', "Owner drawing"),
        'capital_injection': ('inbound', 'owner_capital', "Capital injection"),
    }

    @api.model
    def _require_money(self):
        if not (self.env.su or self.env.user.has_group('orsquare.group_orsquare_can_see_money')):
            raise AccessError(_("Cash figures are hidden for your role."))

    # ------------------------------------------------------------------ new entry
    @api.model
    def new_entry(self, kind, amount, mode='cash', description=None, account_id=None):
        """Expense/Income voucher, owner drawing, capital injection: a real payment against the
        chosen ledger account. Cash vouchers feed the Daybook's live expected cash."""
        if not (self.env.su or self.env.user.has_group('orsquare.group_orsquare_cashier')):
            raise AccessError(_("You are not allowed to record cash entries."))
        if kind not in self.VOUCHERS:
            raise UserError(_("Unknown voucher type '%s'.", kind))
        amount = float(amount)
        if amount <= 0:
            raise UserError(_("The amount must be positive."))
        env = self.sudo().env
        company = self.env.company
        ptype, acc_key, label = self.VOUCHERS[kind]
        account = env['account.account'].browse(int(account_id)) if account_id \
            else env['orsquare.shop.bootstrap'].account(acc_key, company)
        journal = env['orsquare.accounts.service']._journal(env, mode)
        method_line = journal.inbound_payment_method_line_ids[:1] if ptype == 'inbound' \
            else journal.outbound_payment_method_line_ids[:1]
        payment = env['account.payment'].create({
            'payment_type': ptype, 'partner_type': 'customer' if ptype == 'inbound' else 'supplier',
            'amount': amount, 'journal_id': journal.id, 'payment_method_line_id': method_line.id,
            'destination_account_id': account.id, 'memo': description or label})
        payment.action_post()
        env['orsquare.event'].publish(company, 'cash_entry', {'kind': kind, 'mode': mode}, money={'amount': amount})
        return payment.id

    # ------------------------------------------------------------------ register
    @api.model
    def _liquidity_accounts(self, env, company):
        """Cash/bank ledger accounts -> 'cash' | 'bank' (UPI is a bank journal)."""
        journals = env['account.journal'].search([('company_id', '=', company.id), ('type', 'in', ('cash', 'bank'))])
        by_account = {}
        for j in journals:
            for acc in j.default_account_id | j.inbound_payment_method_line_ids.payment_account_id \
                    | j.outbound_payment_method_line_ids.payment_account_id:
                by_account[acc.id] = 'cash' if j.type == 'cash' else 'bank'
        return by_account

    @api.model
    def register(self, date_from=None, date_to=None, mode=None):
        """Chronological register with in/out and running balance (by operational business date)."""
        self._require_money()
        env = self.sudo().env
        company = self.env.company
        acc_mode = self._liquidity_accounts(env, company)
        domain = [('company_id', '=', company.id), ('parent_state', '=', 'posted'),
                  ('account_id', 'in', list(acc_mode))]
        if mode:
            domain.append(('account_id', 'in', [a for a, m in acc_mode.items() if m == mode]))
        opening = 0.0
        if date_from:
            opening = sum(env['account.move.line'].search(
                domain + [('move_id.orsquare_business_date', '<', date_from)]).mapped('balance'))
            domain.append(('move_id.orsquare_business_date', '>=', date_from))
        if date_to:
            domain.append(('move_id.orsquare_business_date', '<=', date_to))
        lines = env['account.move.line'].search(domain, order='date, id')
        rows = [{
            'at': l.create_date.isoformat(), 'date': str(l.move_id.orsquare_business_date or l.date),
            'description': l.name or l.move_id.ref or l.move_id.name, 'voucher': l.move_id.name,
            'type': l.move_id.move_type if l.move_id.move_type != 'entry' else (l.payment_id and 'payment' or 'entry'),
            'mode': acc_mode[l.account_id.id], 'in': l.debit, 'out': l.credit, 'source': 'ledger',
        } for l in lines]
        # Live rows: POS payments of the still-open session are not in the ledger until the day is sealed.
        day = env['orsquare.business_day'].get_open_day(company)
        if day and day.session_id and day.session_id.state != 'closed' \
                and (not date_from or str(day.date) >= str(date_from)) and (not date_to or str(day.date) <= str(date_to)):
            for pay in day.session_id.order_ids.payment_ids:
                m = pay.payment_method_id
                if m.orsquare_key not in ('cash', 'upi') or (mode and (m.orsquare_key == 'cash') != (mode == 'cash')):
                    continue
                rows.append({'at': pay.create_date.isoformat(), 'date': str(day.date),
                             'description': pay.pos_order_id.name, 'voucher': pay.pos_order_id.name,
                             'type': 'pos_sale', 'mode': 'cash' if m.orsquare_key == 'cash' else 'bank',
                             'in': max(pay.amount, 0.0), 'out': max(-pay.amount, 0.0), 'source': 'pos_live'})
        rows.sort(key=lambda r: r['at'])
        running = opening
        for r in rows:
            running += r['in'] - r['out']
            r['balance'] = float_round(running, precision_rounding=company.currency_id.rounding)
        cash_in, cash_out = sum(r['in'] for r in rows), sum(r['out'] for r in rows)
        return {'opening': opening, 'rows': rows, 'cash_in': cash_in, 'cash_out': cash_out,
                'net': cash_in - cash_out, 'closing': running}
