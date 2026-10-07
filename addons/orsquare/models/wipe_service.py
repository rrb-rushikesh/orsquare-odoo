# -*- coding: utf-8 -*-
"""Safe shop-data wipe.

Two-step confirmation (typed shop name + the owner's password), a mandatory pre-wipe backup that is
verified (exists, non-empty, SHA-256 recorded) BEFORE anything is touched, then an atomic purge of
operational data only.  Master data (products, partners, chart of accounts, journals, taxes,
locations, units, users, settings) is never touched.

Because every shop is its own database, a wipe can never reach another shop.  The purge issues
ordered SQL ``DELETE`` statements (children first) instead of ORM ``unlink`` -- posted entries are
immutable by design -- and deliberately NOT ``TRUNCATE ... CASCADE``: that follows foreign keys
regardless of their ON DELETE rule and would reach master tables (e.g. ``res_company`` points at the
opening move).  ``DELETE`` honours each foreign key's own cascade / set-null rule, so master data
cannot be touched.
"""
import hashlib
import logging
import os
import shutil
from datetime import datetime

from odoo import api, fields, models, _
from odoo.exceptions import AccessDenied, AccessError, UserError
from odoo.service import db as db_service

_logger = logging.getLogger(__name__)

# Children first. The list is the contract of what a wipe clears.
OPERATIONAL_TABLES = [
    # sale lines first: they point at opened bottles
    'pos_payment', 'pos_order_line',
    # orsquare operational data (points at POS sessions / pickings / locations)
    'orsquare_stock_discrepancy', 'orsquare_opened_bottle', 'orsquare_day_audit_log', 'orsquare_business_day',
    'orsquare_event',
    # orders
    'pos_order', 'pos_session', 'purchase_order_line', 'purchase_order',
    # accounting ledger
    'account_partial_reconcile', 'account_full_reconcile', 'account_payment', 'account_bank_statement_line',
    'account_bank_statement', 'account_move_line', 'account_move',
    # stock
    'stock_scrap', 'stock_landed_cost', 'stock_valuation_layer', 'stock_move_line', 'stock_move',
    'stock_package_level', 'stock_picking', 'stock_quant', 'stock_quant_package', 'stock_lot',
]
WIPED_MODELS = [
    'account.move', 'account.payment', 'stock.picking', 'stock.move', 'pos.order', 'pos.session',
    'purchase.order', 'stock.landed.cost', 'stock.scrap', 'orsquare.business_day',
]


class OrsquareConsoleAudit(models.Model):
    _name = 'orsquare.console_audit'
    _description = "Data Control / Console Audit (immutable)"
    _order = 'id desc'

    action = fields.Char(required=True, readonly=True)
    user_id = fields.Many2one('res.users', readonly=True)
    company_id = fields.Many2one('res.company', readonly=True)
    backup_reference = fields.Char(readonly=True)
    backup_path = fields.Char(readonly=True)
    backup_sha256 = fields.Char(readonly=True)
    backup_size = fields.Integer(readonly=True)
    details = fields.Json(readonly=True)

    def write(self, vals):
        raise UserError(_("Audit records are immutable."))

    def unlink(self):
        raise UserError(_("Audit records are immutable."))


class OrsquareWipeService(models.AbstractModel):
    _name = 'orsquare.wipe.service'
    _description = "ORSquare Safe Data Wipe"

    @api.model
    def _require_owner(self):
        if not (self.env.su or self.env.user.has_group('orsquare.group_orsquare_owner')):
            raise AccessError(_("Only the shop owner can wipe shop data."))

    @api.model
    def _verify_challenge(self, confirm_name, password):
        company = self.env.company
        if (confirm_name or '').strip() != company.name:
            raise UserError(_("Type the shop name exactly as registered to continue."))
        try:
            self.env.user._check_credentials({'type': 'password', 'password': password or ''}, {'interactive': False})
        except AccessDenied:
            raise UserError(_("The password is not correct."))

    # ------------------------------------------------------------------ preview
    @api.model
    def preview(self):
        """Step 1: what will be cleared and what is preserved (counts from the live database)."""
        self._require_owner()
        cr = self.env.cr
        cleared = {}
        for table in OPERATIONAL_TABLES:
            cr.execute("SELECT to_regclass(%s)", [table])
            if cr.fetchone()[0]:
                cr.execute('SELECT COUNT(*) FROM "%s"' % table)
                cleared[table] = cr.fetchone()[0]
        env = self.sudo().env
        preserved = {
            'products': env['product.template'].search_count([]),
            'partners': env['res.partner'].search_count([]),
            'accounts': env['account.account'].search_count([]),
            'journals': env['account.journal'].search_count([]),
            'taxes': env['account.tax'].search_count([]),
            'users': env['res.users'].search_count([]),
        }
        return {'will_clear': cleared, 'will_keep': preserved,
                'note': "An automated backup is created and verified before anything is cleared."}

    # ------------------------------------------------------------------ backup
    @api.model
    def _create_backup(self):
        env = self.sudo().env
        data_dir = env['ir.config_parameter'].get_param('orsquare.backup_dir') \
            or os.path.join(odoo_data_dir(), 'orsquare_backups')
        os.makedirs(data_dir, exist_ok=True)
        stamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
        dbname = self.env.cr.dbname
        tmp = db_service.dump_db(dbname, None, 'zip')
        try:
            digest = hashlib.sha256()
            size = 0
            tmp.seek(0)
            target = os.path.join(data_dir, 'pre-wipe-%s-%s.zip' % (dbname, stamp))
            with open(target, 'wb') as out:
                while True:
                    chunk = tmp.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
        finally:
            tmp.close()
        if not os.path.exists(target) or size <= 0:
            raise UserError(_("The automated backup failed; nothing was cleared."))
        sha = digest.hexdigest()
        initials = ''.join(w[0] for w in self.env.company.name.split()[:3]).upper() or 'SHOP'
        reference = 'BAK-%s-%s-%s' % (datetime.utcnow().strftime('%Y%m%d'), initials, sha[:4].upper())
        return {'reference': reference, 'path': target, 'sha256': sha, 'size': size}

    # ------------------------------------------------------------------ wipe
    @api.model
    def wipe_shop(self, confirm_name, password):
        self._require_owner()
        self._verify_challenge(confirm_name, password)
        company = self.env.company
        # Step A: backup FIRST. Any failure aborts before a single row is touched.
        backup = self._create_backup()
        cr = self.env.cr
        # Step B: purge operational data (one transaction; rolls back as a whole on error)
        existing = []
        for table in OPERATIONAL_TABLES:
            cr.execute("SELECT to_regclass(%s)", [table])
            if cr.fetchone()[0]:
                existing.append(table)
        env = self.sudo().env
        wh = env['stock.warehouse'].orsquare_main_warehouse(company)
        for table in existing:
            cr.execute('DELETE FROM "%s"' % table)
        cr.execute("DELETE FROM mail_message WHERE model = ANY(%s)", [WIPED_MODELS])
        cr.execute("DELETE FROM ir_attachment WHERE res_model = ANY(%s)", [WIPED_MODELS])
        # per-bottle locations are operational state; the three topology locations stay
        env.invalidate_all()
        bottle_locs = env['stock.location'].with_context(active_test=False).search([
            ('location_id', '=', wh.orsquare_opened_id.id)])
        bottle_locs.unlink()
        env.invalidate_all()
        env['orsquare.console_audit'].create({
            'action': 'OPERATIONAL_DATA_WIPED', 'user_id': self.env.uid, 'company_id': company.id,
            'backup_reference': backup['reference'], 'backup_path': backup['path'],
            'backup_sha256': backup['sha256'], 'backup_size': backup['size'],
            'details': {'tables': existing}})
        env['orsquare.event'].publish(company, 'shop_wiped', {'backup': backup['reference']})
        return {'status': 'success', 'backup_reference': backup['reference'], 'sha256': backup['sha256']}


def odoo_data_dir():
    from odoo.tools import config
    return config['data_dir']
