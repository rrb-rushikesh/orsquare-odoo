# Developer Auth Session Leak and Hydration Crashes

## Problem
1. **Database Session Leaking:** When switching from retail counter (`orsquare_shop1`) to Developer Console (`/dev`), Werkzeug retained `request.db = 'orsquare_shop1'` in the session cookie. `_resolve_db` in `addons/orsquare/controllers/main.py` blindly trusted `request.db`, attempting to authenticate platform developers against the shop database rather than `orsquare_platform`, throwing `AccessDenied` ("Wrong shop, login or password").
2. **Missing Canonical Partner SQL Resolution:** In Odoo, `email`, `phone`, and `mobile` live on `res_partner` (`u.partner_id`), not `res_users`. Querying `res_users` directly caused `UndefinedColumn: column "email" does not exist`.
3. **Hydration Crashes on Developer Login (`reading 'name'` and `reading 'can_see_money'`):** Developer accounts returned from `orsquare.platform.service` lacked `company` and `flags` in the user envelope. In `frontend/src/auth/AuthContext.tsx`, `activeShop` accessed `me.company.name` without optional chaining, and `value` accessed `me?.flags.can_see_money` without optional chaining. Stale `localStorage` cached states also lacked these properties.

## Solution
1. In `_resolve_db`, prioritize `surface='dev'`, dev hostnames, explicit platform db, and developer emails over stale cookies.
2. In `main.py`, join `res_users` with `res_partner` to authenticate users seamlessly by Email, Phone, or Username.
3. In `addons/orsquare_platform/models/platform.py`, return a complete `Me` envelope with standard `company`, `flags`, and `roles: ['developer']`.
4. In `AuthContext.tsx`, use optional chaining (`me?.flags?.can_see_money`, `me.company?.name ?? 'ORSquare Platform'`), guard `startStore()` to only run for retail shops, and normalize stale `localStorage` objects on startup in `readCached()` and `adopt()`.
