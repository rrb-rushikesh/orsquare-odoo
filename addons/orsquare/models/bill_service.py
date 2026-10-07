# -*- coding: utf-8 -*-
"""Bill documents for printing / reprint / share.

The backend returns the authoritative, fully-computed bill (taxes, totals, GST breakup, HSN, UPI QR
string, statutory bottle matrix); the React app owns the visual layout.  For silent thermal printing
it can also ask for ready-made fixed-width text or raw ESC/POS bytes (paper cut + cash-drawer kick).
Targets such as ``<100 ms`` dispatch are benchmark targets for the client/hardware path, not claims.
"""
import base64
from collections import OrderedDict, defaultdict
from urllib.parse import quote

import zoneinfo
from datetime import timezone

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError

ESC_INIT = b'\x1b\x40'
ESC_BOLD_ON, ESC_BOLD_OFF = b'\x1b\x45\x01', b'\x1b\x45\x00'
ESC_CENTER, ESC_LEFT = b'\x1b\x61\x01', b'\x1b\x61\x00'
CUT = b'\x1d\x56\x41\x03'                 # partial cut after 3-dot feed
DRAWER_KICK = b'\x1b\x70\x00\x19\xfa'      # pulse pin 2


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    orsquare_mrp = fields.Monetary(string="MRP", currency_field='currency_id',
                                   help="Maximum Retail Price printed on the bill. Never used to price a sale.")


class OrsquareBillService(models.AbstractModel):
    _name = 'orsquare.bill.service'
    _description = "ORSquare Bill Documents"

    # ------------------------------------------------------------------ data
    @api.model
    def _get_order(self, order_id):
        if not (self.env.su or self.env.user.has_group('orsquare.group_orsquare_cashier')):
            raise AccessError(_("You are not allowed to print bills."))
        order = self.sudo().env['pos.order'].browse(int(order_id)).exists()
        if not order or order.company_id != self.env.company:
            raise UserError(_("Unknown bill."))
        return order

    @api.model
    def _local(self, dt, company):
        return dt.replace(tzinfo=timezone.utc).astimezone(zoneinfo.ZoneInfo(company.orsquare_tz))

    @api.model
    def bill_document(self, order_id):
        order = self._get_order(order_id)
        company = order.company_id
        currency = order.currency_id
        partner = company.partner_id
        local = self._local(order.date_order, company)
        taxes = OrderedDict()
        lines, base_total = [], 0.0
        for i, l in enumerate(order.lines, 1):
            unit = l.price_unit * (1 - l.discount / 100.0)
            res = l.tax_ids_after_fiscal_position.compute_all(unit, currency, l.qty, product=l.product_id,
                                                              partner=order.partner_id)
            for t in res['taxes']:
                row = taxes.setdefault(t['name'], {'name': t['name'], 'base': 0.0, 'amount': 0.0})
                row['base'] += t['base']
                row['amount'] += t['amount']
            tmpl = l.product_id.product_tmpl_id
            lines.append({
                'sr': i, 'name': l.full_product_name, 'hsn': tmpl.l10n_in_hsn_code or '',
                'mrp': tmpl.orsquare_mrp or None, 'qty': l.qty, 'uom': l.product_id.uom_id.name,
                'is_peg': bool(l.orsquare_peg_ml), 'peg_ml': l.orsquare_peg_ml or None,
                'rate': l.price_unit, 'discount_pct': l.discount, 'taxable': l.price_subtotal,
                'tax': l.price_subtotal_incl - l.price_subtotal, 'total': l.price_subtotal_incl,
            })
            base_total += l.price_subtotal
        concession = order.orsquare_concession
        refunded = order.lines.refunded_orderline_id.order_id
        doc = {
            'template': company.orsquare_bill_template, 'thermal_width': company.orsquare_thermal_width,
            'header': {
                'name': company.name, 'address': ', '.join(x for x in (
                    partner.street, partner.street2, partner.city, partner.state_id.name, partner.zip) if x),
                'gstin': partner.vat or '', 'phone': partner.phone or '', 'fssai': company.orsquare_fssai_no or '',
                'liquor_license': company.orsquare_liquor_license_no or '',
            },
            'bill': {
                'order_id': order.id, 'number': order.account_move.name or order.name, 'receipt_no': order.name,
                'date': local.strftime('%d/%m/%Y'), 'time': local.strftime('%H:%M'),
                'business_date': str(order.orsquare_business_date), 'cashier': order.user_id.name,
                'is_refund': order.amount_total < 0, 'is_tax_invoice': bool(order.account_move),
                'refund_of': ', '.join(refunded.mapped('name')) if refunded else '',
                'customer': {'name': order.partner_id.name or '', 'gstin': order.partner_id.vat or '',
                             'state': order.partner_id.state_id.name or ''},
            },
            'lines': lines,
            'taxes': list(taxes.values()),
            'totals': {
                'taxable': base_total, 'tax': order.amount_tax, 'total': order.amount_total,
                'concession': concession, 'payable': order.amount_total - concession,
                'in_words': currency.amount_to_text(abs(order.amount_total)),
            },
            'payments': [{'method': p.payment_method_id.name, 'key': p.payment_method_id.orsquare_key,
                          'amount': p.amount} for p in order.payment_ids],
            'upi_qr': self._upi_uri(company, order),
            'columns': {'hsn': company.orsquare_show_hsn, 'mrp': company.orsquare_show_mrp},
            'footer': company.report_footer and str(company.report_footer) or '',
        }
        if company.orsquare_show_excise_matrix:
            doc['excise_matrix'] = self._excise_matrix(order)
        if company.orsquare_bill_template == 'a4':
            doc['bank_details'] = company.orsquare_bank_details or ''
        return doc

    @api.model
    def _upi_uri(self, company, order):
        """Dynamic UPI QR payload (NPCI intent URI) for the amount still to collect."""
        if not company.orsquare_upi_id or order.amount_total <= 0:
            return None
        return "upi://pay?pa=%s&pn=%s&am=%.2f&cu=INR&tn=%s" % (
            quote(company.orsquare_upi_id), quote(company.name), order.amount_total - order.orsquare_concession,
            quote(order.name))

    @api.model
    def _excise_matrix(self, order):
        """Bottles by container size (ml) for statutory excise footers. Counts whole bottles only;
        pegs are poured liquid, not bottles."""
        matrix = defaultdict(float)
        for l in order.lines:
            cap = l.product_id.orsquare_capacity_ml
            if cap and not l.orsquare_peg_ml:
                matrix[int(cap) if cap == int(cap) else cap] += l.qty
        return [{'size_ml': k, 'bottles': v} for k, v in sorted(matrix.items())]

    # ------------------------------------------------------------------ thermal text / ESC-POS
    @api.model
    def thermal_text(self, order_id, cols=None):
        """Fixed-width receipt (58 mm = 32 cols, 80 mm = 48 cols)."""
        doc = self.bill_document(order_id)
        cols = int(cols or (48 if doc['thermal_width'] == '80' else 32))
        W = cols
        out = []

        def center(t):
            out.append(t[:W].center(W).rstrip())

        def row(left, right):
            left = str(left)
            room = W - len(right) - 1
            out.append(left[:room].ljust(room) + ' ' + right)

        h, b = doc['header'], doc['bill']
        center(h['name'].upper())
        if h['address']:
            for chunk in self._wrap(h['address'], W):
                center(chunk)
        if h['gstin']:
            center("GSTIN: %s" % h['gstin'])
        if h['liquor_license']:
            center("Lic: %s" % h['liquor_license'])
        out.append('-' * W)
        row("Bill: %s" % b['receipt_no'], "%s %s" % (b['date'], b['time']))
        if b['is_refund']:
            center("*** RETURN ***")
        if b['customer']['name']:
            out.append(("To: %s" % b['customer']['name'])[:W])
        out.append('-' * W)
        for l in doc['lines']:
            for chunk in self._wrap(l['name'], W):
                out.append(chunk)
            qty = ('%g' % l['qty']) if not l['is_peg'] else '1 peg'
            row("  %s x %.2f" % (qty, l['rate'] if not l['is_peg'] else l['total']), "%.2f" % l['total'])
        out.append('-' * W)
        t = doc['totals']
        for tax in doc['taxes']:
            row(tax['name'], "%.2f" % tax['amount'])
        row("TOTAL", "%.2f" % t['total'])
        if t['concession']:
            row("Concession", "-%.2f" % t['concession'])
        for p in doc['payments']:
            row(p['method'], "%.2f" % p['amount'])
        out.append('-' * W)
        if doc['footer']:
            center(doc['footer'][:W])
        center("Thank you!")
        return out

    @staticmethod
    def _wrap(text, width):
        words, line, chunks = text.split(), '', []
        for w in words:
            if len(line) + len(w) + (1 if line else 0) > width:
                chunks.append(line)
                line = w
            else:
                line = (line + ' ' + w) if line else w
        if line:
            chunks.append(line)
        return chunks or ['']

    @api.model
    def escpos(self, order_id, cols=None, open_drawer=True):
        """Raw ESC/POS job (base64): init, the receipt, paper cut and optional cash-drawer pulse."""
        lines = self.thermal_text(order_id, cols)
        data = ESC_INIT + b'\n'.join(l.encode('cp437', 'replace') for l in lines) + b'\n\n\n' + CUT
        if open_drawer:
            data += DRAWER_KICK
        return base64.b64encode(data).decode()
