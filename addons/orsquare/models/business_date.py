# -*- coding: utf-8 -*-
"""Business-day attribution (``orsquare_business_date``).

Odoo stamps documents with UTC timestamps.  A shop that trades until 02:00 needs the 01:30 sale to
belong to *yesterday's* business day.  The authoritative business date is computed once, at
creation, from the shop timezone and cutoff hour, and is then immutable.  It is deliberately
separate from accounting dates and lock dates: it only drives ORSquare's operational day
(daybook, calendar, sealed-day guard), never the ledger.
"""
import zoneinfo
from datetime import datetime, timedelta, timezone

from odoo import api, fields, models, _
from odoo.exceptions import UserError


def business_date_for(dt_utc, tz_name, cutoff_hour):
    """Pure function so it is trivially unit-testable.

    ``dt_utc``: naive datetime in UTC (Odoo convention).  Exactly at the cutoff a new business day
    starts: 02:00:00 belongs to the new day, 01:59:59 to the previous one.
    """
    aware = dt_utc.replace(tzinfo=timezone.utc).astimezone(zoneinfo.ZoneInfo(tz_name))
    return (aware - timedelta(hours=cutoff_hour)).date()


class ResCompany(models.Model):
    _inherit = 'res.company'

    def orsquare_business_date_for(self, dt=None):
        self.ensure_one()
        dt = dt or fields.Datetime.now()
        if isinstance(dt, str):
            dt = fields.Datetime.to_datetime(dt)
        return business_date_for(dt, self.orsquare_tz, self.orsquare_cutoff_hour)

    def orsquare_current_business_date(self):
        return self.orsquare_business_date_for(fields.Datetime.now())

    def orsquare_business_day_bounds(self, business_date):
        """UTC [start, end) datetimes (naive) of a business day."""
        self.ensure_one()
        tz = zoneinfo.ZoneInfo(self.orsquare_tz)
        start_local = datetime.combine(business_date, datetime.min.time(), tzinfo=tz) \
            + timedelta(hours=self.orsquare_cutoff_hour)
        start = start_local.astimezone(timezone.utc).replace(tzinfo=None)
        end_local = start_local + timedelta(days=1)
        end = end_local.astimezone(timezone.utc).replace(tzinfo=None)
        return start, end


class BusinessDateMixin(models.AbstractModel):
    _name = 'orsquare.business.date.mixin'
    _description = "Business Date Attribution"

    orsquare_business_date = fields.Date(
        string="Business Date", index=True, copy=False, readonly=True,
        help="Operational ORSquare business day this record belongs to (shop cutoff applied).")

    def _orsquare_event_datetime(self, vals):
        """Moment the real-world event happened. Offline sales pass their own timestamp."""
        return self.env.context.get('orsquare_event_dt') or fields.Datetime.now()

    @api.model_create_multi
    def create(self, vals_list):
        companies = {}
        for vals in vals_list:
            if vals.get('orsquare_business_date'):
                continue
            company_id = vals.get('company_id') or self.env.company.id
            company = companies.setdefault(company_id, self.env['res.company'].browse(company_id))
            vals['orsquare_business_date'] = company.orsquare_business_date_for(
                self._orsquare_event_datetime(vals))
        records = super().create(vals_list)
        if not self.env.context.get('orsquare_allow_sealed'):
            records._orsquare_check_day_open()
        return records

    def _orsquare_check_day_open(self):
        BusinessDay = self.env['orsquare.business_day'].sudo()
        seen = set()
        for rec in self:
            key = (rec.company_id.id, rec.orsquare_business_date)
            if key in seen or not rec.orsquare_business_date:
                continue
            seen.add(key)
            BusinessDay.check_day_not_sealed(rec.company_id, rec.orsquare_business_date)

    def write(self, vals):
        if 'orsquare_business_date' in vals and not self.env.context.get('orsquare_allow_sealed'):
            raise UserError(_("The business date of a document cannot be changed."))
        return super().write(vals)


class AccountMove(models.Model):
    _name = 'account.move'
    _inherit = ['account.move', 'orsquare.business.date.mixin']


class AccountPayment(models.Model):
    _name = 'account.payment'
    _inherit = ['account.payment', 'orsquare.business.date.mixin']


class StockMove(models.Model):
    _name = 'stock.move'
    _inherit = ['stock.move', 'orsquare.business.date.mixin']


class StockPicking(models.Model):
    _name = 'stock.picking'
    _inherit = ['stock.picking', 'orsquare.business.date.mixin']


class PurchaseOrder(models.Model):
    _name = 'purchase.order'
    _inherit = ['purchase.order', 'orsquare.business.date.mixin']


class PosOrder(models.Model):
    _name = 'pos.order'
    _inherit = ['pos.order', 'orsquare.business.date.mixin']
