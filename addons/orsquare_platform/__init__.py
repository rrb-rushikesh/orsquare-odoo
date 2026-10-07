# -*- coding: utf-8 -*-
from . import models

# The generic /api/call dispatcher lives in the orsquare module and only runs whitelisted services: register the
# platform service there. (orsquare is server-wide, so its package is always importable.)
from odoo.addons.orsquare.api_registry import API_REGISTRY

API_REGISTRY['platform'] = ('orsquare.platform.service', {
    # identity & fleet
    'me', 'fleet', 'shop_detail', 'shop_health',
    # provisioning & lifecycle
    'create_shop', 'suspend', 'reactivate', 'archive', 'delete_shop', 'reset_owner_password', 'set_expiry', 'extend',
    # inside a shop
    'shop_experience', 'studio_apply', 'shop_staff', 'shop_staff_create', 'shop_staff_update', 'shop_staff_reset_password',
    'shop_staff_reset_mfa', 'shop_audit',
    # plans & operators
    'plans', 'save_plan', 'delete_plan', 'push_plan',
    'operators', 'create_operator', 'set_operator_role', 'set_operator_active', 'reset_operator_password',
    'reset_operator_mfa',
    # platform
    'audit', 'system', 'rebuild_directory', 'adopt_unregistered'})
