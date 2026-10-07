# -*- coding: utf-8 -*-
"""Accounts tab: customers (Khata), suppliers, employees, others.

A balance is ALWAYS the sum of posted ledger lines (never edited, never stored by us). Settlements
are real ``account.payment`` records reconciled against the open lines, so corrections are
reversals, preserving the audit trail.
"""
from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError
from odoo.tools import float_compare, float_is_zero, float_round

from .security_utils import require_staff

KINDS = ('customer', 'supplier', 'employee', 'other')


class ResCompany(models.Model):
    _inherit = 'res.company'

    orsquare_khata_overdue_days = fields.Integer(string="Khata Overdue After (days)", default=30)


class ResPartner(models.Model):
    _inherit = 'res.partner'

    orsquare_kind = fields.Selection([(k, k.title()) for k in KINDS], string="Account Type", index=True)


class OrsquareAccountsService(models.AbstractModel):
    _name = 'orsquare.accounts.service'
    _description = "ORSquare Accounts Service"

    # ------------------------------------------------------------------ helpers
    @api.model
    def _can_see_money(self):
        return self.env.su or self.env.user.has_group('orsquare.group_orsquare_can_see_money')

    @api.model
    def _require(self, group):
        if not (self.env.su or self.env.user.has_group(group)):
            raise AccessError(_("You are not allowed to do that."))

    @api.model
    def _balances(self, partner_ids=None):
        """{partner_id: {'receivable': x, 'payable': y}} from posted ledger lines only."""
        env = self.sudo().env
        domain = [('parent_state', '=', 'posted'), ('company_id', '=', self.env.company.id),
                  ('account_id.account_type', 'in', ('asset_receivable', 'liability_payable')),
                  ('partner_id', '!=', False)]
        if partner_ids:
            domain.append(('partner_id', 'in', partner_ids))
        out = {}
        for partner, account, balance in env['account.move.line']._read_group(
                domain, ['partner_id', 'account_id'], ['balance:sum']):
            row = out.setdefault(partner.id, {'receivable': 0.0, 'payable': 0.0})
            if account.account_type == 'asset_receivable':
                row['receivable'] += balance
            else:
                row['payable'] += -balance
        return out

    @api.model
    def _kind_of(self, partner, employee_partner_ids):
        if partner.id in employee_partner_ids:
            return 'employee'
        if partner.orsquare_kind:
            return partner.orsquare_kind
        if partner.supplier_rank and not partner.customer_rank:
            return 'supplier'
        return 'customer'

    # ------------------------------------------------------------------ GSTIN
    GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

    @api.model
    def lookup_gstin(self, gstin):
        """Validate an Indian GSTIN offline: format, state code, embedded PAN and the mod-36 check character.

        This proves the number is *well-formed*, not that the taxpayer is active (that needs the GST portal).
        """
        import re
        g = (gstin or '').strip().upper()
        result = {'gstin': g, 'valid': False, 'state_code': g[:2], 'state': '', 'pan': g[2:12] if len(g) == 15 else '',
                  'reason': ''}
        if not re.match(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$', g):
            result['reason'] = 'Not a valid GSTIN format (15 characters: state, PAN, entity, Z, check).'
            return result
        state = self.sudo().env['res.country.state'].search(
            [('country_id.code', '=', 'IN'), ('l10n_in_tin', '=', g[:2])], limit=1)
        if not state:
            result['reason'] = 'Unknown state code %s.' % g[:2]
            return result
        total, factor = 0, 2          # Luhn mod-36: weights alternate 2,1,2,1... from the rightmost of the 14 chars
        for ch in reversed(g[:14]):
            digit = factor * self.GSTIN_CHARS.index(ch)
            total += digit // 36 + digit % 36
            factor = 1 if factor == 2 else 2
        check = self.GSTIN_CHARS[(36 - total % 36) % 36]
        if check != g[14]:
            result['reason'] = 'The check character does not match (a digit is probably mistyped).'
            return result
        result.update({'valid': True, 'state': state.name})
        return result

    # ------------------------------------------------------------------ directory
    @api.model
    def directory(self, kind='all', search=None, limit=80, offset=0):
        require_staff(self.env)
        env = self.sudo().env
        domain = [('company_id', 'in', (False, self.env.company.id)), ('is_company', 'in', (True, False)),
                  ('id', '!=', self.env.company.partner_id.id)]
        if search:
            domain += ['|', '|', ('name', 'ilike', search), ('mobile', 'ilike', search), ('phone', 'ilike', search)]
        employees = env['hr.employee'].search([('company_id', '=', self.env.company.id)])
        emp_partner_ids = set(employees.work_contact_id.ids)
        partners = env['res.partner'].search(domain, order='name', limit=2000)
        balances = self._balances(partners.ids)
        see = self._can_see_money()
        rows, tot_recv, tot_pay, n_cust, n_sup = [], 0.0, 0.0, 0, 0
        for p in partners:
            k = self._kind_of(p, emp_partner_ids)
            bal = balances.get(p.id, {'receivable': 0.0, 'payable': 0.0})
            if k == 'customer':
                n_cust += 1
                tot_recv += bal['receivable']
            elif k == 'supplier':
                n_sup += 1
                tot_pay += bal['payable']
            if kind != 'all' and k != kind.rstrip('s'):
                continue
            signed = bal['receivable'] - bal['payable']
            side = 'Dr' if signed > 0 else 'Cr' if signed < 0 else 'Flat'
            rows.append({
                'id': p.id, 'name': p.name, 'mobile': p.mobile or p.phone or '', 'kind': k,
                'receivable': bal['receivable'] if see else None, 'payable': bal['payable'] if see else None,
                'balance': abs(signed) if see else None, 'side': side if see else None,
                'is_receivable': signed > 0 if see else False, 'is_payable': signed < 0 if see else False,
                'is_advance': (signed < 0 if k == 'customer' else signed > 0 if k == 'supplier' else False) if see else False,
                'is_settled': signed == 0 if see else False,
            })
        return {
            'rows': rows[offset:offset + limit], 'count': len(rows),
            'summary': {'receivables': tot_recv if see else None, 'payables': tot_pay if see else None,
                        'customers': n_cust, 'suppliers': n_sup},
        }

    @api.model
    def create_party(self, name, kind, mobile=None, opening_balance=0.0, gstin=None):
        self._require('orsquare.group_orsquare_cashier')
        if kind not in KINDS:
            raise UserError(_("Unknown account type '%s'.", kind))
        if not (name or '').strip():
            raise UserError(_("A name is required."))
        env = self.sudo().env
        vals = {'name': name.strip(), 'mobile': mobile or False, 'orsquare_kind': kind, 'vat': gstin or False}
        if kind == 'customer':
            vals['customer_rank'] = 1
        elif kind == 'supplier':
            vals['supplier_rank'] = 1
        partner = env['res.partner'].create(vals)
        if kind == 'employee':
            env['hr.employee'].create({'name': name.strip(), 'work_contact_id': partner.id,
                                       'company_id': self.env.company.id})
        if opening_balance:
            self._post_opening_balance(partner, kind, float(opening_balance))
        return partner.id

    @api.model
    def _post_opening_balance(self, partner, kind, amount):
        """Owner opening balance as a real journal entry against Opening Balance Equity."""
        env = self.sudo().env
        company = self.env.company
        boot = env['orsquare.shop.bootstrap']
        equity = boot.account('opening_equity', company)
        if kind in ('customer', 'other', 'employee') and amount > 0:        # they owe us
            receivable = partner.with_company(company).property_account_receivable_id
            lines = [(receivable, amount, 0.0), (equity, 0.0, amount)]
        else:                                                              # we owe them
            payable = partner.with_company(company).property_account_payable_id
            lines = [(equity, abs(amount), 0.0), (payable, 0.0, abs(amount))]
        misc = env['account.journal'].search([('company_id', '=', company.id), ('type', '=', 'general'),
                                              ('code', '=', 'MISC')], limit=1)
        move = env['account.move'].create({
            'move_type': 'entry', 'journal_id': misc.id, 'date': fields.Date.context_today(self),
            'ref': _("Opening balance - %s", partner.name),
            'line_ids': [(0, 0, {'account_id': a.id, 'debit': d, 'credit': c, 'partner_id': partner.id,
                                 'name': _("Opening balance")}) for a, d, c in lines]})
        move.action_post()

    # ------------------------------------------------------------------ statement
    @api.model
    def statement(self, partner_id, date_from=None, date_to=None):
        """Chronological dossier with running balance (receivable positive; payable shown negative)."""
        if not self._can_see_money():
            raise AccessError(_("Balances are hidden for your role."))
        env = self.sudo().env
        domain = [('partner_id', '=', int(partner_id)), ('parent_state', '=', 'posted'),
                  ('company_id', '=', self.env.company.id),
                  ('account_id.account_type', 'in', ('asset_receivable', 'liability_payable'))]
        before = 0.0
        if date_from:
            before = sum(env['account.move.line'].search(domain + [('date', '<', date_from)]).mapped('balance'))
            domain.append(('date', '>=', date_from))
        if date_to:
            domain.append(('date', '<=', date_to))
        lines = env['account.move.line'].search(domain, order='date, id')
        running, rows = before, []
        for l in lines:
            running += l.balance
            rows.append({'id': l.id, 'date': str(l.date), 'voucher': l.move_id.name, 'ref': l.move_id.ref or '',
                         'description': l.name or '', 'debit': l.debit, 'credit': l.credit,
                         'balance': float_round(running, precision_rounding=self.env.company.currency_id.rounding),
                         'side': 'Dr' if running > 0 else 'Cr' if running < 0 else 'Flat'})
        return {'opening': before, 'opening_side': 'Dr' if before > 0 else 'Cr' if before < 0 else 'Flat', 'rows': rows, 'closing': running,
                'total_debit': sum(lines.mapped('debit')), 'total_credit': sum(lines.mapped('credit')),
                'side': 'Dr' if running > 0 else 'Cr' if running < 0 else 'Flat'}

    # ------------------------------------------------------------------ settlements
    @api.model
    def _journal(self, env, method):
        company = self.env.company
        if method == 'cash':
            return env['account.journal'].search([('company_id', '=', company.id), ('type', '=', 'cash')], limit=1)
        if method == 'upi':
            return env['orsquare.shop.bootstrap'].journal('upi', company)
        return env['account.journal'].search([('company_id', '=', company.id), ('type', '=', 'bank'),
                                              ('code', '!=', 'UPI')], limit=1)

    @api.model
    def _settle(self, partner_id, amount, method, direction, note):
        env = self.sudo().env
        amount = float(amount)
        if amount <= 0:
            raise UserError(_("The amount must be positive."))
        partner = env['res.partner'].browse(int(partner_id)).exists()
        if not partner:
            raise UserError(_("Unknown account."))
        company = self.env.company
        journal = self._journal(env, method)
        method_line = journal.inbound_payment_method_line_ids[:1] if direction == 'inbound' \
            else journal.outbound_payment_method_line_ids[:1]
        payment = env['account.payment'].create({
            'payment_type': direction, 'partner_type': 'customer' if direction == 'inbound' else 'supplier',
            'partner_id': partner.id, 'amount': amount, 'journal_id': journal.id,
            'payment_method_line_id': method_line.id, 'memo': note or False,
        })
        payment.action_post()
        atype = 'asset_receivable' if direction == 'inbound' else 'liability_payable'
        counter = payment.move_id.line_ids.filtered(lambda l: l.account_id.account_type == atype and not l.reconciled)
        open_lines = env['account.move.line'].search([
            ('partner_id', '=', partner.id), ('account_id.account_type', '=', atype), ('reconciled', '=', False),
            ('parent_state', '=', 'posted'), ('company_id', '=', company.id), ('id', 'not in', counter.ids),
            ('balance', '>' if direction == 'inbound' else '<', 0)], order='date, id')
        if open_lines and counter:
            (open_lines | counter).reconcile()
        env['orsquare.event'].publish(company, 'payment_recorded', {
            'partner_id': partner.id, 'direction': direction}, money={'amount': amount})
        return payment.id

    @api.model
    def receive_payment(self, partner_id, amount, method='cash', note=None):
        """Customer receipt against Khata (cash or UPI); feeds the Daybook drawer when cash."""
        self._require('orsquare.group_orsquare_cashier')
        return self._settle(partner_id, amount, method, 'inbound', note)

    @api.model
    def pay_supplier(self, partner_id, amount, method='cash', note=None):
        self._require('orsquare.group_orsquare_stockkeeper')
        return self._settle(partner_id, amount, method, 'outbound', note)

    # ------------------------------------------------------------------ employees
    @api.model
    def employee_voucher(self, employee_partner_id, kind, amount, method='cash', note=None):
        """advance (asset), recovery (reduces the asset) or wage (expense) through the cash/bank journal."""
        self._require('orsquare.group_orsquare_owner')
        env = self.sudo().env
        company = self.env.company
        boot = env['orsquare.shop.bootstrap']
        partner = env['res.partner'].browse(int(employee_partner_id)).exists()
        amount = float(amount)
        if amount <= 0:
            raise UserError(_("The amount must be positive."))
        advances = boot.account('employee_advances', company)
        wage = boot.chart_account('210100', company)
        direction, dest = {'advance': ('outbound', advances), 'recovery': ('inbound', advances),
                           'wage': ('outbound', wage)}[kind]
        journal = self._journal(env, method)
        method_line = journal.inbound_payment_method_line_ids[:1] if direction == 'inbound' \
            else journal.outbound_payment_method_line_ids[:1]
        payment = env['account.payment'].create({
            'payment_type': direction, 'partner_type': 'supplier', 'partner_id': partner.id,
            'amount': amount, 'journal_id': journal.id, 'payment_method_line_id': method_line.id,
            'destination_account_id': dest.id, 'memo': note or kind.title()})
        payment.action_post()
        return payment.id

    @api.model
    def employee_advance_balance(self, employee_partner_id):
        env = self.sudo().env
        acc = env['orsquare.shop.bootstrap'].account('employee_advances')
        return sum(env['account.move.line'].search([
            ('partner_id', '=', int(employee_partner_id)), ('account_id', '=', acc.id),
            ('parent_state', '=', 'posted')]).mapped('balance'))
