# -*- coding: utf-8 -*-
"""Restaurant / bar table tabs and kitchen order tickets (KOT).

A *tab* is a native **draft** ``pos.order`` sitting on a ``restaurant.table`` (Odoo's own ``table_id`` /
``customer_count``). Draft orders move no stock and post nothing, so any number of waiters on any device
can add to the same tab; the tab only becomes real when ``sales.settle(table_id=…)`` pays it, in the same
transaction in which the draft is removed (exactly once).

Each line carries a client ``key`` so repeated saves update lines in place instead of recreating them, which is
what lets the kitchen see exactly what is *new* since the last ticket.
"""
import uuid

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError
from odoo.tools import float_compare, float_is_zero, float_round

from .security_utils import require_staff


class PosOrderLine(models.Model):
    _inherit = 'pos.order.line'

    orsquare_line_key = fields.Char(string="Client Line Key", copy=False, index=True)
    orsquare_kot_qty = fields.Float(string="Sent to kitchen/bar", copy=False, digits=(16, 6))
    orsquare_note = fields.Char(string="Line note (e.g. no onion)", copy=False)


class OrsquareTabService(models.AbstractModel):
    _name = 'orsquare.tab.service'
    _description = "ORSquare Table Tabs & KOT"

    # ------------------------------------------------------------------ helpers
    @api.model
    def _need(self):
        if not (self.env.su or self.env.user.has_group('orsquare.group_orsquare_cashier')):
            raise AccessError(_("You are not allowed to take table orders."))
        if not self.env.company.orsquare_feature_tables:
            raise UserError(_("Restaurant tables are switched off for this shop (Business Studio)."))

    @api.model
    def _get_table(self, table_id):
        table = self.sudo().env['restaurant.table'].browse(int(table_id)).exists()
        if not table:
            raise UserError(_("Unknown table."))
        return table

    @api.model
    def _tab(self, table, create=False, covers=None):
        env = self.sudo().env
        tab = env['pos.order'].search([
            ('table_id', '=', table.id), ('state', '=', 'draft'), ('company_id', '=', self.env.company.id)], limit=1)
        if tab or not create:
            return tab
        company = self.env.company
        day = env['orsquare.business_day'].ensure_open_day(company, company.orsquare_effective_business_date())
        config = day.session_id.config_id
        return env['pos.order'].create({
            'session_id': day.session_id.id, 'config_id': config.id, 'company_id': company.id,
            'pricelist_id': config.pricelist_id.id, 'user_id': self.env.uid, 'table_id': table.id,
            'customer_count': int(covers or 0), 'amount_tax': 0.0, 'amount_total': 0.0, 'amount_paid': 0.0,
            'amount_return': 0.0, 'uuid': str(uuid.uuid4()), 'lines': [],
        })

    @api.model
    def _station(self, line):
        return 'kitchen' if line.product_id.is_kitchen else 'bar'

    @api.model
    def _render(self, tab):
        station_total = {'kitchen': 0.0, 'bar': 0.0}
        lines = []
        for l in tab.lines:
            lines.append({
                'key': l.orsquare_line_key, 'line_id': l.id, 'product_id': l.product_id.id,
                'name': l.full_product_name, 'qty': l.qty, 'price': l.price_unit, 'discount': l.discount,
                'total': l.price_subtotal_incl, 'note': l.orsquare_note or '', 'is_peg': bool(l.orsquare_peg_ml),
                'station': self._station(l), 'sent_qty': l.orsquare_kot_qty,
                'pending_qty': round(l.qty - l.orsquare_kot_qty, 6),
            })
        return {
            'tab_id': tab.id, 'table_id': tab.table_id.id, 'table': tab.table_id.display_name,
            'covers': tab.customer_count, 'total': tab.amount_total, 'tax': tab.amount_tax,
            'opened_at': tab.create_date.isoformat() if tab.create_date else None,
            'waiter': tab.user_id.name, 'lines': lines,
        }

    # ------------------------------------------------------------------ status board
    @api.model
    def table_status(self):
        """Spatial grid data: every table with free/occupied state, running total and age."""
        require_staff(self.env)
        env = self.sudo().env
        tabs = {t.table_id.id: t for t in env['pos.order'].search([
            ('state', '=', 'draft'), ('table_id', '!=', False), ('company_id', '=', self.env.company.id)])}
        out = []
        for floor in env['restaurant.floor'].search([]):
            rows = []
            for t in floor.table_ids.sorted('table_number'):
                tab = tabs.get(t.id)
                rows.append({
                    'table_id': t.id, 'number': t.table_number, 'seats': t.seats,
                    'x': t.position_h, 'y': t.position_v, 'w': t.width, 'h': t.height, 'shape': t.shape,
                    'state': 'occupied' if tab else 'free', 'covers': tab.customer_count if tab else 0,
                    'total': tab.amount_total if tab and (
                        self.env.su or self.env.user.has_group('orsquare.group_orsquare_can_see_money')) else None,
                    'since': tab.create_date.isoformat() if tab and tab.create_date else None,
                })
            out.append({'floor_id': floor.id, 'name': floor.name, 'tables': rows})
        return out

    # ------------------------------------------------------------------ tab lifecycle
    @api.model
    def tab_open(self, table_id, covers=None):
        self._need()
        tab = self._tab(self._get_table(table_id), create=True, covers=covers)
        if covers and not tab.customer_count:
            tab.customer_count = int(covers)
        return self._render(tab)

    @api.model
    def tab_get(self, table_id):
        self._need()
        tab = self._tab(self._get_table(table_id))
        if not tab:
            raise UserError(_("This table has no open tab."))
        return self._render(tab)

    @api.model
    def tab_save(self, table_id, lines, covers=None):
        """Replace the tab's items with ``lines`` (each with a stable ``key``), priced by the server."""
        self._need()
        env = self.sudo().env
        company = self.env.company
        table = self._get_table(table_id)
        tab = self._tab(table, create=True, covers=covers)
        config = tab.config_id
        sales = env['orsquare.sale.service']
        for raw in lines:
            if not raw.get('key'):
                raise UserError(_("Every line needs a client key."))
        priced, _need, _peg = sales._prepare_lines(
            env, {'lines': lines}, config, tab.partner_id, tab.fiscal_position_id, company.currency_id, True)
        wanted = {}
        for raw, vals in zip(lines, priced):
            vals = dict(vals, orsquare_line_key=raw['key'], orsquare_note=raw.get('note') or False)
            wanted[raw['key']] = vals
        existing = {l.orsquare_line_key: l for l in tab.lines}
        commands = []
        for key, vals in wanted.items():
            if key in existing:
                commands.append((1, existing[key].id, {k: v for k, v in vals.items()
                                                       if k not in ('orsquare_opened_bottle_id',)}))
            else:
                commands.append((0, 0, vals))
        for key, line in existing.items():
            if key not in wanted:
                commands.append((2, line.id, 0))
        tab.write({'lines': commands})
        total_incl = sum(tab.lines.mapped('price_subtotal_incl'))
        total_excl = sum(tab.lines.mapped('price_subtotal'))
        tab.write({'amount_total': float_round(total_incl, precision_rounding=company.currency_id.rounding),
                   'amount_tax': float_round(total_incl - total_excl, precision_rounding=company.currency_id.rounding)})
        if covers:
            tab.customer_count = int(covers)
        env['orsquare.event'].publish(company, 'tab_changed', {'table_id': table.id})
        return self._render(tab)

    @api.model
    def tab_transfer(self, from_table_id, to_table_id):
        """Move a tab to another table; if the target already has one, the two are merged."""
        self._need()
        env = self.sudo().env
        src_table, dst_table = self._get_table(from_table_id), self._get_table(to_table_id)
        if src_table == dst_table:
            raise UserError(_("Choose a different table."))
        src = self._tab(src_table)
        if not src:
            raise UserError(_("Table %s has no open tab.", src_table.table_number))
        dst = self._tab(dst_table)
        if not dst:
            src.table_id = dst_table
            result = self._render(src)
        else:
            for line in src.lines:
                clash = dst.lines.filtered(lambda l: l.orsquare_line_key == line.orsquare_line_key)
                if clash:
                    line.orsquare_line_key = '%s-%s' % (line.orsquare_line_key, uuid.uuid4().hex[:6])
            src.lines.write({'order_id': dst.id})
            dst.customer_count = (dst.customer_count or 0) + (src.customer_count or 0)
            total = sum(dst.lines.mapped('price_subtotal_incl'))
            excl = sum(dst.lines.mapped('price_subtotal'))
            dst.write({'amount_total': total, 'amount_tax': total - excl})
            src.unlink()
            result = self._render(dst)
        env['orsquare.event'].publish(self.env.company, 'tab_changed', {'table_id': dst_table.id})
        env['orsquare.event'].publish(self.env.company, 'tab_changed', {'table_id': src_table.id})
        return result

    @api.model
    def tab_cancel(self, table_id, reason=None):
        """Discard an unpaid tab. Needs a reason once anything has gone to the kitchen/bar."""
        self._need()
        table = self._get_table(table_id)
        tab = self._tab(table)
        if not tab:
            return True
        if any(l.orsquare_kot_qty for l in tab.lines) and not (reason or '').strip():
            raise UserError(_("Items were already sent to the kitchen/bar; enter a reason to cancel the tab."))
        tab.unlink()
        self.sudo().env['orsquare.event'].publish(self.env.company, 'tab_changed', {'table_id': table.id})
        return True

    # ------------------------------------------------------------------ kitchen / bar tickets
    @api.model
    def tab_kot(self, table_id, station=None):
        """Print what is NEW (and what was cancelled) since the last ticket for a station.

        ``station`` is ``kitchen`` (dishes), ``bar`` (everything else) or None for both.
        """
        self._need()
        table = self._get_table(table_id)
        tab = self._tab(table)
        if not tab:
            raise UserError(_("This table has no open tab."))
        company = self.env.company
        items, cancelled = [], []
        for l in tab.lines:
            st = self._station(l)
            if station and st != station:
                continue
            diff = float_round(l.qty - l.orsquare_kot_qty, precision_digits=6)
            if float_is_zero(diff, precision_digits=6):
                continue
            row = {'name': l.full_product_name, 'qty': abs(diff), 'note': l.orsquare_note or '', 'station': st}
            (items if diff > 0 else cancelled).append(row)
            l.orsquare_kot_qty = l.qty
        if not items and not cancelled:
            raise UserError(_("Nothing new to send."))
        local = self.env['orsquare.bill.service']._local(fields.Datetime.now(), company)
        ticket = {
            'table': table.display_name, 'table_number': table.table_number, 'covers': tab.customer_count,
            'waiter': self.env.user.name, 'time': local.strftime('%H:%M'), 'station': station or 'all',
            'items': items, 'cancelled': cancelled,
        }
        ticket['text'] = self._ticket_text(ticket, 32 if company.orsquare_thermal_width == '58' else 48)
        self.sudo().env['orsquare.event'].publish(company, 'kot_sent', {'table_id': table.id, 'station': station or 'all'})
        return ticket

    @api.model
    def _ticket_text(self, t, cols):
        out = ["KOT - %s" % t['station'].upper(), "Table %s   Covers %s" % (t['table_number'], t['covers']),
               "%s   %s" % (t['time'], t['waiter']), '-' * cols]
        for i in t['items']:
            out.append(("%g x %s" % (i['qty'], i['name']))[:cols])
            if i['note']:
                out.append(("   * %s" % i['note'])[:cols])
        for i in t['cancelled']:
            out.append(("CANCEL %g x %s" % (i['qty'], i['name']))[:cols])
        return out
