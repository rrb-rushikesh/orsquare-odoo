/**
 * Alignment check for the built site. It opens every page at phone, tablet and
 * desktop widths in a real browser and fails when something sits off the grid:
 *   - any text, button or image outside the page container's left and right edges
 *     (unless it is inside its own scroll or clip box, such as a drawn table);
 *   - the logo, the first heading and the footer's legal line not starting on the
 *     container's left edge;
 *   - at desktop width, the Sign in button, the last footer column and the footer
 *     support numbers not ending on the container's right edge;
 *   - the page scrolling sideways.
 * Needs a browser, so it is not part of `npm run check`. Run it with the preview
 * server up (npm run preview -- --port 4321):
 *   PLAYWRIGHT_MODULE=<path to the playwright package> node scripts/alignment.mjs
 * Playwright is deliberately not a dependency of this project. CHROME_PATH may name a
 * Chrome or Chromium executable; SITE_URL defaults to http://127.0.0.1:4321.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const base = process.env.SITE_URL || 'http://127.0.0.1:4321'
const executablePath =
  process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined)
const paths = ['/', '/modules', '/pricing', '/faq', '/about', '/contact', '/signup', '/privacy', '/terms', '/refund-cancellation', '/404']
const widths = [390, 768, 1440]
const TOLERANCE = 1.5

const browser = await chromium.launch({ executablePath })
const problems = []

for (const width of widths) {
  const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage()
  for (const path of paths) {
    await page.goto(base + path)
    const found = await page.evaluate(
      ({ width, tolerance }) => {
        const out = []
        const container = document.querySelector('.topbar__inner')
        const box = container.getBoundingClientRect()
        const pad = parseFloat(getComputedStyle(container).paddingLeft)
        const left = box.left + pad
        const right = box.right - pad
        const rect = (el) => el?.getBoundingClientRect()
        const clipped = (el) => {
          for (let a = el.parentElement; a; a = a.parentElement) {
            const o = getComputedStyle(a).overflowX
            if (o === 'hidden' || o === 'auto' || o === 'scroll') return true
          }
          return false
        }
        const visible = (el) => {
          const r = el.getBoundingClientRect()
          const s = getComputedStyle(el)
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
        }

        if (document.documentElement.scrollWidth > width) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${width})`)

        // Everything with content stays inside the container.
        const scope = document.querySelectorAll('.topbar a, .topbar img, main p, main h1, main h2, main h3, main li, main a, main img, main table, .footer a, .footer p, .footer img, .footer li')
        scope.forEach((el) => {
          if (!visible(el) || clipped(el)) return
          // Full-bleed backgrounds are sections, not these elements, so these must fit.
          const r = el.getBoundingClientRect()
          if (r.left < left - tolerance || r.right > right + tolerance) {
            out.push(`outside the container: <${el.tagName.toLowerCase()} class="${el.className}"> ${Math.round(r.left)}-${Math.round(r.right)} (container ${Math.round(left)}-${Math.round(right)})`)
          }
        })

        const startsOnLeft = (label, el) => {
          if (!el || !visible(el)) return
          const r = rect(el)
          if (Math.abs(r.left - left) > tolerance) out.push(`${label} starts at ${Math.round(r.left)}, container edge is ${Math.round(left)}`)
        }
        // On phones the logo is centred in the compact bar by design.
        if (width > 672) startsOnLeft('logo', document.querySelector('.topbar .brand'))
        startsOnLeft('first heading', document.querySelector('main h1'))
        startsOnLeft('footer logo', document.querySelector('.footer .brand'))
        startsOnLeft('footer legal line', document.querySelector('.footer__legal'))

        if (width >= 1000) {
          const endsOnRight = (label, el) => {
            if (!el || !visible(el)) return
            const r = rect(el)
            if (Math.abs(r.right - right) > tolerance) out.push(`${label} ends at ${Math.round(r.right)}, container edge is ${Math.round(right)}`)
          }
          endsOnRight('Sign in button', document.querySelector('.topbar .nav__signin'))
          const cols = document.querySelectorAll('.footer__col')
          endsOnRight('last footer column', cols[cols.length - 1])
          endsOnRight('footer support numbers', document.querySelector('.footer__support'))
        }
        return out
      },
      { width, tolerance: TOLERANCE },
    )
    for (const issue of found) problems.push(`${width}px ${path}: ${issue}`)
  }
}

await browser.close()
if (problems.length) {
  console.error(`alignment check failed (${problems.length}):\n- ` + problems.join('\n- '))
  process.exit(1)
}
console.log(`alignment check passed: ${paths.length} pages x ${widths.length} widths`)
