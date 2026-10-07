# Landing-page quality (applies to `landing/`)

> **Repository status — 2026-10-07:** These visual/content rules remain binding for landing changes. This repository cleanup changes documentation only in `landing/`; it does not establish Lighthouse or visual acceptance. See [current status](../STATUS.md).

Read this before you change anything under `landing/`. It exists because the public site once shipped with content flush against the viewport edge, a disabled contact form, an edge-to-edge proof strip, grids with empty grey cells, and drawn screens with unlabelled numbers. Each of those is now a rule.

## 1. Scope: the site, and only the site
1. Site work edits `landing/` only. Never touch `frontend/`, `control-plane/`, `orsquare/`, the dashboard, or any internal tab, and never touch the visual baselines in `frontend/tests/visual/__screenshots__`.
2. Before you commit: `git diff --name-only main...HEAD`. Anything outside `landing/` (other than a deliberate rule, doc or status update the owner asked for) is a defect. Fix it, or revert that file.
3. One logical change per commit, `[P1]` in the message, so the owner can revert any of them. Push only when the owner explicitly requests it; never merge or rebase without authorization.

## 2. Design: [frontend/DESIGN.md](../frontend/DESIGN.md) is the law
1. 0px corners, 1px hairlines, no shadows, no pills, one chromatic accent (`#0f62fe`), Plex Sans 300 for display and 400/600 below, body tracking `0.16px`, sentence-case labels, no all-caps eyebrows.
2. Depth comes from surface change (`canvas` → `layer`) and hairlines. The only gradient is the soft blue hero wash; no dot or pattern backgrounds. The only dark surface is the footer; the closing call to action is the blue banner.
3. Take ideas (layout, explanation order, product demonstrations) from other sites. Never take their radius, shadows, colours or type. If a reference needs a rounded card, redraw it square.
4. Use the tokens in `global.css`. No new hex values for brand colour. The only extra colours allowed are the muted financial green/red (always with a text label) and Carbon blue tints for data series.

## 3. Structure: nothing unfinished
1. Every page: one `<h1>`, a one-sentence lede, real content, and a next step (link or button). A page that is only a heading and a list is unfinished.
2. Every section: a heading, one sentence saying why it matters, then content that shows or states something specific. Delete a section that has none.
3. All content sits inside `.container` or the `DocLayout` shell. No bare `.prose`, no full-bleed text, nothing flush to the viewport edge.
4. Card grids use the `.grid` / `.tiles` patterns (hairlines without a filler cell). A grid must never show an empty grey cell, and a lone orphan card in a row is fixed by changing the column rule, not by adding a decoy card.
5. No placeholders: no lorem, TODO, "coming soon", disabled forms or buttons that go nowhere. If something is not available (a contact address, signup), say so plainly and show the real route instead.
6. Use `DocLayout` for long text (legal, policies). Use a dedicated layout for About, Contact, Sign-up and the home page.

## 4. Content clarity
1. Facts only. Take wording from `docs/tabs/*`, [current status](../STATUS.md) and the relevant workflow specifications in `docs/` and the app's own public pages. No invented customers, counts, certifications, uptime, prices, awards, quotes or integrations.
2. Explain the product by showing it: a drawn screen (HTML and CSS, no images, no scripts) next to a sentence in plain words. A visitor must learn what OR² does, who it is for and what the reports and calendar give them within one scroll of the home page.
3. Any number in a drawn screen is sample data. Label it ("Sample data"), keep the figures internally consistent (rates × quantities = amounts, splits = totals), and mark the drawing `aria-hidden` with the meaning carried by real text beside it.
4. Name things as the product does (Sheet, Day book, Reports calendar, khata). Active voice, sentence case, buttons say what happens ("Sign in to your workspace", not "Submit").
5. OR² and ORSQUARE are one name for one product and company. Never write "ORSQUARE builds OR²" or "OR² by ORSQUARE"; write "OR²", and use the spelled-out "OR² (ORSQUARE)" once where the full name helps. Do not name the underlying software vendors. Do not describe a module the product does not have.

## 5. Responsive, accessible, fast
1. Check at 390, 768 and 1440 px. No horizontal page scroll, no clipped text, no overlapping blocks. Wide drawn tables scroll inside their own box. The utility strip hides below 672px.
2. Tap targets at least 44px. Visible keyboard focus. Sufficient contrast (4.5:1 for text). Interactive drawings (the feature explorer) work with the keyboard and with JavaScript off.
3. No third-party origins: no analytics, fonts from other hosts, embeds or trackers. No client framework. Images only when needed, with `width` and `height`.
4. Every page keeps its JSON-LD (Organization, SoftwareApplication, BreadcrumbList; FAQPage on `/faq`), one canonical URL and a unique title and description. A price is never emitted as an `Offer` until the owner publishes one.

## 6. Proof before you say it is done
Run all of these and read the output. Do not claim a check you did not run.
1. `cd landing && npm run check` builds the site and runs `scripts/check.mjs`: one `<h1>`, unique titles and descriptions of sensible length, canonical links, parsing JSON-LD, alt text, no third-party origins, no placeholder wording, and every internal link and anchor resolving. It must print `landing check passed`.
2. Lighthouse, mobile, on `/`, `/about`, `/contact`, `/modules`, `/faq` and one legal page: Performance, Accessibility, Best Practices and SEO each at least 95. Use `npx lighthouse`; never add it to `package.json`. If Accessibility is below 95, fix the real violation. Never disable an audit.
3. A headless-browser pass at 390, 768 and 1440 px over every page: `document.documentElement.scrollWidth` must equal `clientWidth`, and you must open at least the home page, one document page and one new section as screenshots and look at them.
4. Claims match the product documents. Every label, figure and sentence in a drawn screen or a feature claim must be checked against `docs/tabs/*`, [current status](../STATUS.md) and the relevant workflow specifications in `docs/` and the app's own screens (for example the dashboard says "Customers owe" and "You owe suppliers", so a drawing says the same). Offline use, printers, GST and calendar content are worded only as far as those documents go.
5. `git diff --name-only main...HEAD` shows only the paths this rule allows.

## 6a. Placement and alignment: decide where it goes before you add it
Every addition (a line of text, a link, a number, a button, a section) is placed deliberately, never appended wherever there is room. Before writing it:
1. **Say where and why.** Name the exact region (header bar, footer bottom bar, hero, a card) and the reason it belongs there. If a region already has a job (the footer's bottom bar is the legal line on the left), add to that job's grid instead of stacking a new row under it.
2. **Use the grid.** Content sits on the container's edges: left-aligned things start on the container's left edge, right-aligned things end on its right edge, and items in a bar are two groups (left and right) or one centred group, never a loose pile of inline pieces. Spacing comes from the spacing tokens, not from leftover gaps.
3. **Group related items.** A phone number and its WhatsApp link are one unit, and the units line up with each other. Two lines of different kinds do not share a left edge with a cramped gap: separate them into the bar's left and right groups.
4. **Check the exact region, at 1440 and 390 px, with your own eyes,** after the change: take a screenshot of that region and look at it. Look for stacked cramped lines, uneven gaps, misaligned edges, an empty half, and wrapping that looks accidental. "It builds" is not a check.
5. **Run `node scripts/alignment.mjs`** (see its header; it needs a browser and the preview server). It fails when anything sits outside the container, when the logo, first heading or footer legal line miss the left edge, when the Sign in button, last footer column or support numbers miss the right edge, or when the page scrolls sideways. It must print `alignment check passed`.
6. If you cannot say in one sentence where the addition goes and why, stop and ask rather than guess.

## 7. Regressions this rule exists to stop
Content outside the container; items dropped into a bar with no alignment (the footer support line stacked under the copyright); a form that is switched off; a strip that touches the screen edge; a grid with a grey filler cell; mixed corner radii; shadows or pills; unlabelled mock figures; a section with a heading and nothing to say; screenshots-only explanations that a crawler or screen reader cannot read; edits to the app "while you were there".
