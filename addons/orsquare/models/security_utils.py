# -*- coding: utf-8 -*-
"""Small shared permission helpers."""

def require_staff(env):
    """Any ORSquare role (cashier / stockkeeper / owner). Reads are masked per permission on top of this."""
    if env.su:
        return
    user = env.user
    if not (user.has_group('orsquare.group_orsquare_cashier') or user.has_group('orsquare.group_orsquare_stockkeeper')
            or user.has_group('orsquare.group_orsquare_owner')):
        from odoo.exceptions import AccessError
        raise AccessError("You are not allowed to do that.")
