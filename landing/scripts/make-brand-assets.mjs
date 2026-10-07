/**
 * One-off generator for the brand image assets, kept in the repo so they can be
 * regenerated rather than hand-edited. Run with:
 *   node scripts/make-brand-assets.mjs
 * The single source is public/logo.png (the supplied OR² logo, 512x512). From it
 * this writes, into landing/public:
 *   - favicon.ico (16/32/48), favicon-16/32/48.png
 *   - apple-touch-icon.png (180), icon-192.png, icon-512.png, icon-maskable-512.png
 *   - og/<page>.png (1200x630 social cards, one per page group)
 * Google Search asks for a favicon that is a multiple of 48px, at a stable URL, in a
 * format such as ICO or PNG, so those are provided. No network, no third-party service.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const pub = resolve(here, '..', 'public')
const source = await readFile(resolve(pub, 'logo.png'))
const BLUE = '#0f62fe'
const FONT = 'Helvetica, Arial, sans-serif'

const square = (size) => sharp(source).resize(size, size).png({ compressionLevel: 9 }).toBuffer()

const sizes = {
  'favicon-16.png': 16,
  'favicon-32.png': 32,
  'favicon-48.png': 48,
  'apple-touch-icon.png': 180,
  'icon-192.png': 192,
  'icon-512.png': 512,
}
const buffers = {}
for (const [file, size] of Object.entries(sizes)) {
  buffers[file] = await square(size)
  await writeFile(resolve(pub, file), buffers[file])
}

// Maskable icon: the logo inside the safe zone on a blue field.
const inner = await square(400)
await writeFile(
  resolve(pub, 'icon-maskable-512.png'),
  await sharp({ create: { width: 512, height: 512, channels: 4, background: BLUE } })
    .composite([{ input: inner, left: 56, top: 56 }])
    .png({ compressionLevel: 9 })
    .toBuffer(),
)

// favicon.ico with three PNG-encoded images (16, 32, 48).
const entries = [
  [16, buffers['favicon-16.png']],
  [32, buffers['favicon-32.png']],
  [48, buffers['favicon-48.png']],
]
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(entries.length, 4)
let offset = 6 + entries.length * 16
const dir = []
const data = []
for (const [size, buf] of entries) {
  const e = Buffer.alloc(16)
  e.writeUInt8(size, 0)
  e.writeUInt8(size, 1)
  e.writeUInt16LE(1, 4)
  e.writeUInt16LE(32, 6)
  e.writeUInt32LE(buf.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += buf.length
  dir.push(e)
  data.push(buf)
}
await writeFile(resolve(pub, 'favicon.ico'), Buffer.concat([header, ...dir, ...data]))

// Open Graph / social cards, one per page group, so a shared link says what the page is.
const W = 1200
const H = 630
const logo104 = (await square(104)).toString('base64')
const CARDS = {
  home: ['Billing, stock and accounts', 'in one workspace.', 'Godown and counter stock, supplier dues, khata, cash flow,', 'day book and reports for shops, suppliers and restaurants.'],
  modules: ['Every module,', 'included from day one.', 'Counter sales, two-location stock, purchases, khata, cash flow,', 'day book, ledgers, reports and exports.'],
  pricing: ['One plan.', 'Every module included.', 'No tiers and no add-ons.', 'Fees are set in your service agreement.'],
  faq: ['Straight answers', 'about OR².', 'Billing, stock, khata, GST, cash, the day book,', 'offline use, data and access.'],
  about: ['About OR² (ORSQUARE)', 'What it is, and who it is for.', 'A business-operations platform for shops, suppliers,', 'distributors and restaurants.'],
  contact: ['Contact OR²', 'Support, onboarding and enquiries.', 'Reach us through your workspace administrator.', ''],
  legal: ['Privacy, terms and', 'cancellations and refunds.', 'Drafts pending legal review.', ''],
}
await mkdir(resolve(pub, 'og'), { recursive: true })
for (const [slug, [l1, l2, s1, s2]] of Object.entries(CARDS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="wash" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#edf5ff"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#wash)"/>
  <rect width="${W}" height="8" fill="${BLUE}"/>
  <image x="80" y="84" width="104" height="104" href="data:image/png;base64,${logo104}"/>
  <text x="212" y="150" font-family="${FONT}" font-size="40" font-weight="700" fill="#161616">OR&#178;</text>
  <text x="212" y="184" font-family="${FONT}" font-size="26" fill="#393939">ORSQUARE</text>
  <text x="80" y="330" font-family="${FONT}" font-size="72" fill="#161616" letter-spacing="-1">${l1}</text>
  <text x="80" y="414" font-family="${FONT}" font-size="72" fill="#161616" letter-spacing="-1">${l2}</text>
  <text x="80" y="498" font-family="${FONT}" font-size="30" fill="#393939">${s1}</text>
  <text x="80" y="540" font-family="${FONT}" font-size="30" fill="#393939">${s2}</text>
</svg>`
  await writeFile(resolve(pub, 'og', `${slug}.png`), await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer())
}
console.log('brand assets written to', pub)
