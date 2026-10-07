# -*- coding: utf-8 -*-
"""Small shared permission helpers."""
from odoo.exceptions import AccessError
from odoo.tools.translate import _


def require_staff(env):
    """Any ORSquare role (cashier / stockkeeper / owner). Reads are masked per permission on top of this."""
    if env.su:
        return
    user = env.user
    if not (user.has_group('orsquare.group_orsquare_cashier') or user.has_group('orsquare.group_orsquare_stockkeeper')
            or user.has_group('orsquare.group_orsquare_owner')):
        raise AccessError("You are not allowed to do that.")


def user_can_use_tabs(env, tabs):
    """True when the caller holds at least one of ``tabs`` (granted, switched on for the shop, allowed by the plan)."""
    if env.su:
        return True
    return bool(set(env.user.orsquare_effective_tabs()) & set(tabs))


def require_tab(env, *tabs):
    if not user_can_use_tabs(env, tabs):
        raise AccessError(_("This part of the app is not available to you."))


def enforce_gate(env, service, method):
    """The server-side gate in front of every whitelisted API call (see ``API_GATES``)."""
    from ..api_registry import API_GATES
    gates = API_GATES.get(service)
    if not gates or env.su:
        return
    spec = gates.get(method) or gates.get('*')
    if not spec:
        return
    require_tab(env, *spec['tabs'])
    feature = spec.get('feature')
    if feature and not env.company.orsquare_feature_on(feature):
        raise AccessError(_("This feature is switched off for this shop."))
