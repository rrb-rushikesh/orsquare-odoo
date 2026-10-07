# OR² public site (landing)

Static Astro site: marketing, pricing, FAQ, legal drafts. No analytics, no third-party scripts.
```
npm ci            # install
npm run dev       # dev server
npm run build     # static build
npm run preview   # serve the build (--host 127.0.0.1 --port 4321)
npm run check     # build, then verify titles, links, anchors, JSON-LD, origins
```

Env vars (all optional, defaults in `src/config/site.ts`): `PUBLIC_SITE_URL` (canonical origin),
`PUBLIC_APP_URL` (sign-in target), `PUBLIC_SIGNUP_URL`, `PUBLIC_CONTACT_EMAIL`.

Output: `landing/dist` (plain static files). Rules: `landing/QUALITY.md`.

## In the ORSquare monorepo (integration notes)

This folder is the Astra marketing site copied **unchanged** from `orsquare-tryton/landing`; it is a separate project
(own `package.json`, no shared code with the retailer app or the Developer Console).
Production build: `PUBLIC_APP_URL=https://app.orsquare.com/login npm run build` -> serve `dist/` as `/srv/landing`
(see `deploy/Caddyfile`: the gate redirects signed-in visitors to the app *before* any landing HTML is sent).
