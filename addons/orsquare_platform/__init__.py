# -*- coding: utf-8 -*-
from . import models

# The generic /api/call dispatcher lives in the orsquare module and only runs whitelisted services: register the
# platform service there. (orsquare is server-wide, so its package is always importable.)
from odoo.addons.orsquare.api_registry import API_REGISTRY

API_REGISTRY['platform'] = ('orsquare.platform.service', {
    'fleet', 'shop_detail', 'create_shop', 'suspend', 'reactivate', 'reset_owner_password', 'set_expiry', 'extend',
    'studio_apply', 'audit', 'system'})
