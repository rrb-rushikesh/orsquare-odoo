---
title: Operator Sign-in Had No Throttle and Guarded Code Fails Silent
type: note
permalink: orsquare/bugs/operator-sign-in-had-no-throttle-and-guarded-code-fails-silent
---

# Bug: Operator Sign-in Had No Brute-force Throttle (and other "guarded, so silently off" traps)

- **Date:** 2026-10-08
- **Files:** `addons/orsquare/controllers/main.py`, `addons/orsquare/models/login_throttle.py`, `addons/orsquare_platform/models/platform.py`

## Finding
The login code protected itself with `if 'orsquare.login_throttle' in env`. The throttle model lives in the **shop** module, which is not installed in the **platform** database, so the guard was always false there: platform operators (who hold the keys to every shop) had **no** brute-force protection. Found only by running the real enrolment flow in the browser (a 500 on the same lookup).

## Fix
Throttle behaviour moved into a shared plain mixin (`ThrottleLogic`); the platform has its own model (`orsquare.platform.throttle`); the controller uses `_throttle(env)` which finds whichever exists. HTTP tests prove 5 wrong passwords -> 429 for operators, and for wrong authenticator codes.

## Same family, also fixed
- Scanning every shop DB to find a user (O(shops) per sign-in, and it loaded other registries mid-request): replaced by the directory.
- A stale `or2_shop` in the browser pinned sign-in to the wrong DB: server now trusts the directory first, browser clears the key on sign-out.

## How to apply
- A security check wrapped in `if model in env` is an off switch when the module is absent. Prefer failing loudly, or test the path in every database type that can reach it.
- Anything that must behave the same in shop and platform DBs needs a test in BOTH (see `TestOperatorSignInOverHttp`).
- Odoo `Environment` has no `.sudo()` (use `env(su=True)`); `_check_credentials` checks the *environment's* user, not the record.
