/**
 * Static checks on the built site (landing/dist). Run `npm run check`, which builds
 * first. It enforces the machine-checkable parts of .agents/rules/landing-quality.md:
 *   - exactly one <h1> per page, a unique title and description of sensible length;
 *   - a canonical link, and JSON-LD that parses;
 *   - every internal link and #anchor resolves to a built page or element;
 *   - every image has alt text, and no page loads from a third-party origin;
 *   - no placeholder wording (lorem, TODO, "coming soon").
 * Layout, contrast and Lighthouse still need a browser; see section 6 of the rule.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const problems = []
const fail = (page, message) => problems.push(`${page}: ${message}`)

async function walk(dir) {
  const out = []
  for (const name of await readdir(dir)) {
    const full = join(dir, name)
    if ((await stat(full)).isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

const files = await walk(dist)
const pages = files.filter((f) => f.endsWith('.html'))
const pageUrl = (file) => {
  const rel = relative(dist, file).replace(/\\/g, '/')
  if (rel === 'index.html') return '/'
  return '/' + rel.replace(/\/index\.html$/, '').replace(/\.html$/, '')
}

const html = new Map()
for (const file of pages) html.set(pageUrl(file), await readFile(file, 'utf8'))
const exists = new Set(files.map((f) => '/' + relative(dist, f).replace(/\\/g, '/')))
const known = (path) => {
  const p = path.replace(/\/+$/, '') || '/'
  return html.has(p) || exists.has(p) || exists.has(p + '/index.html') || exists.has(p + '.html')
}

const titles = new Map()
const descriptions = new Map()

for (const [url, doc] of html) {
  if (url === '/404') continue
  const label = url

  const h1 = (doc.match(/<h1[\s>]/g) ?? []).length
  if (h1 !== 1) fail(label, `${h1} <h1> elements (need exactly 1)`)

  const title = doc.match(/<title>([^<]*)<\/title>/)?.[1]?.trim()
  const description = doc.match(/<meta name="description" content="([^"]*)"/)?.[1]?.trim()
  if (!title || title.length < 20 || title.length > 70) fail(label, `title length ${title?.length ?? 0} (want 20-70)`)
  if (!description || description.length < 90 || description.length > 165) fail(label, `description length ${description?.length ?? 0} (want 90-165)`)
  if (title && titles.has(title)) fail(label, `title duplicates ${titles.get(title)}`)
  if (description && descriptions.has(description)) fail(label, `description duplicates ${descriptions.get(description)}`)
  titles.set(title, label)
  descriptions.set(description, label)

  if (!/<link rel="canonical" href="[^"]+"/.test(doc)) fail(label, 'no canonical link')

  for (const block of doc.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(block[1])
    } catch {
      fail(label, 'JSON-LD does not parse')
    }
  }

  for (const img of doc.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt=/.test(img[0])) fail(label, `image without alt: ${img[0].slice(0, 80)}`)
  }

  const ids = new Set([...doc.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))
  for (const link of doc.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
    const href = link[1]
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:')) continue
    if (/^https?:\/\//.test(href)) continue
    // A query string selects state on an existing page (/signup?plan=pro); the page is what must exist.
    const [pathWithQuery, hash] = href.split('#')
    const path = pathWithQuery.split('?')[0]
    const targetUrl = path === '' ? url : path
    if (path !== '' && !path.startsWith('/')) continue
    // The signed-in app is served elsewhere, so its entry point is not a built page.
    if (targetUrl === '/pos') continue
    if (!known(targetUrl)) fail(label, `broken link ${href}`)
    else if (hash) {
      const target = html.get(targetUrl.replace(/\/+$/, '') || '/')
      if (target && !new RegExp(`\\bid="${hash}"`).test(target)) fail(label, `missing anchor ${href}`)
    }
  }

  // Third-party origins: only our own site, schema.org namespaces and w3.org namespaces.
  for (const m of doc.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) {
    let host
    try {
      host = new URL(m[1]).hostname
    } catch {
      continue
    }
    if (host === 'orsquare.com' || host.endsWith('.orsquare.com') || host === 'localhost' || host === '127.0.0.1') continue
    // Support links open WhatsApp; they are plain anchors and load nothing from it.
    if (host === 'wa.me' && m[0].startsWith('href=')) continue
    fail(label, `third-party origin ${host}`)
  }

  if (/lorem ipsum|\bTODO\b|coming soon/i.test(doc.replace(/<script[\s\S]*?<\/script>/g, ''))) fail(label, 'placeholder wording found')
}

if (problems.length) {
  console.error(`landing check failed (${problems.length}):\n- ` + problems.join('\n- '))
  process.exit(1)
}
console.log(`landing check passed: ${html.size} pages, ${titles.size} unique titles`)
