# Generates docs/backend-api-reference.md from the live API registry (run via scripts/gen_api_docs.sh).
import inspect
import textwrap

from odoo.addons.orsquare.api_registry import API_REGISTRY

lines = [
    "# ORSquare Backend API Reference",
    "",
    "> **Generated** from the live API registry (`addons/orsquare/api_registry.py`) by `scripts/gen_api_docs.sh`. "
    "Do not edit by hand: change the code (signatures/docstrings) and regenerate.",
    "",
    "Every call is `POST /api/call` with a JSON body `{\"service\": <name>, \"method\": <name>, \"params\": {...}}` "
    "(see *HTTP endpoints* in `docs/backend-architecture.md`). `params` are the keyword arguments below. "
    "Only the methods listed here are reachable; each re-checks the caller's role, and money/valuation "
    "figures are masked for users without `can_see_money` / `can_see_valuation`.",
    "",
]
count = 0
for service in sorted(API_REGISTRY):
    model, methods = API_REGISTRY[service]
    lines += ["## `%s`" % service, "", "Model: `%s`" % model, ""]
    cls = type(env[model])
    for name in sorted(methods):
        fn = getattr(cls, name)
        raw = getattr(fn, '__wrapped__', fn)
        sig = inspect.signature(raw)
        params = [p for n, p in sig.parameters.items() if n != 'self']
        sig_txt = ", ".join(
            (p.name + ('=%r' % p.default if p.default is not inspect._empty else '')) for p in params)
        doc = inspect.getdoc(raw) or ''
        first = doc.split('\n\n')[0].replace('\n', ' ').strip()
        lines.append("### `%s.%s(%s)`" % (service, name, sig_txt))
        lines.append("")
        if first:
            lines.append(textwrap.fill(first, 110))
            lines.append("")
        count += 1
lines.append("---")
lines.append("*%d methods across %d services.*" % (count, len(API_REGISTRY)))
open('/tmp/backend-api-reference.md', 'w', encoding='utf-8').write("\n".join(lines) + "\n")
print('GENERATED %d methods' % count)
