/**
 * Single source of truth for the public site: brand facts, URLs, navigation.
 *
 * Brand values are copied from `frontend/src/config/brand.ts` (the app's
 * BRAND_CONFIG) so the marketing site and the logged-in app say the same thing.
 * Nothing here is invented: every value is either copied from the app, read from
 * an environment variable, or an open owner question listed in `landing/STATUS.md`.
 */

/** Copy of BRAND_CONFIG from frontend/src/config/brand.ts. */
export const BRAND = {
  name: 'OR²',
  nameFull: 'OR² (ORSQUARE)',
  legalName: 'OR²',
  shortTagline: 'Simple business operations',
  tagline: 'One simple platform to run your entire business',
  copyrightYear: 2026,
} as const

function envUrl(name: string, fallback: string): string {
  const raw = import.meta.env[name]
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : fallback
}

/** The public origin. Drives canonical links, the sitemap, robots.txt and OG URLs. */
export const SITE_ORIGIN = envUrl('PUBLIC_SITE_URL', 'https://orsquare.com').replace(/\/+$/, '')

/** Absolute URL for a site-relative path such as `/pricing`. */
export function absoluteUrl(path: string): string {
  return `${SITE_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}

/** Where "Login" goes. Defaults to the app's sign-in at http://localhost:5173/login in dev, or PUBLIC_APP_URL in prod. */
export const APP_URL = appUrl(envUrl('PUBLIC_APP_URL', 'http://localhost:5173/login'))

/**
 * Git Bash on Windows rewrites a value like `/login` into `C:/Program Files/Git/login` when it is set
 * as an environment variable for a build, which broke both Sign in buttons. Only a relative path
 * or an http(s) URL is a valid target; anything else falls back to the app's own `/login`.
 */
function appUrl(value: string): string {
  return value.startsWith('/') || /^https?:\/\//i.test(value) ? value : 'http://localhost:5173/login'
}

/**
 * Where "Get started" goes. Signup is not built, so the default is this project's
 * own placeholder page rather than a dead external link.
 */
export const SIGNUP_URL = envUrl('PUBLIC_SIGNUP_URL', '/signup')

/**
 * Public contact address. The owner has not published one yet, so it is empty and
 * every page that needs it says so honestly instead of linking a guessed address.
 */
export const CONTACT_EMAIL = envUrl('PUBLIC_CONTACT_EMAIL', '')

/** True when the owner has supplied a contact address (see STATUS.md). */
export const HAS_CONTACT_EMAIL = CONTACT_EMAIL !== ''

export interface NavItem {
  label: string
  href: string
}

/** Primary navigation, in reading order. Every entry is a page of this site. */
export const NAV: NavItem[] = [
  { label: 'Modules', href: '/modules' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'FAQ', href: '/faq' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
]

export interface FooterColumn {
  heading: string
  links: NavItem[]
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Modules', href: '/modules' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'FAQ', href: '/faq' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Contact', href: '/contact' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
      { label: 'Cancellations and refunds', href: '/refund-cancellation' },
    ],
  },
]

/** The footer strapline, copied from the app's SiteFooter. */
export const FOOTER_LINE =
  'One simple platform for your entire business: stock, purchases, cash and reports in one workspace.'

/**
 * The industries the app's own home page names. Kept verbatim so the marketing
 * site never claims a vertical the product page does not.
 */
export const INDUSTRIES =
  'Retailers · Suppliers · Distributors · Restaurants · And more industries'

/**
 * Every page of this site, with its priority and change frequency. This list is
 * the single input for sitemap.xml and for the links in llms.txt.
 */
export interface PageEntry {
  path: string
  title: string
  description: string
  /** Sitemap `changefreq`. */
  changefreq: 'monthly' | 'yearly'
  /** Sitemap `priority`, 0.0–1.0. */
  priority: number
}

export const PAGES: PageEntry[] = [
  {
    path: '/',
    title: `${BRAND.name} · POS, stock and accounts for shops and restaurants`,
    description:
      'OR² puts billing, godown and counter stock, supplier dues, khata, cash and reports in one workspace for shops, suppliers and restaurants.',
    changefreq: 'monthly',
    priority: 1.0,
  },
  {
    path: '/modules',
    title: `${BRAND.name} modules · Billing, stock, purchases, cash and reports`,
    description:
      'Every OR² module: counter sales, table service, two-location stock, purchases, supplier dues, khata, cash flow, day book, ledgers, reports and exports.',
    changefreq: 'monthly',
    priority: 0.9,
  },
  {
    path: '/pricing',
    title: `${BRAND.name} pricing · Basic ₹999, Pro ₹1,999, 7-day free trial`,
    description:
      'OR² plans: Basic at ₹999 a month and Pro at ₹1,999 a month, both with a 7-day free trial, and Custom for several branches. Every plan includes every module.',
    changefreq: 'monthly',
    priority: 0.9,
  },
  {
    path: '/faq',
    title: `${BRAND.name} FAQ · Billing, stock, khata, GST, day book and data`,
    description:
      'Straight answers on OR²: counter billing, godown and counter stock, khata, cash and the day book, reports, GST, offline use, data privacy, access and support.',
    changefreq: 'monthly',
    priority: 0.8,
  },
  {
    path: '/about',
    title: `About ${BRAND.nameFull} · What it is and who it is for`,
    description:
      `${BRAND.nameFull} is a business-operations platform for shops, suppliers and restaurants. What it does, the principles behind it, and what we do not claim.`,
    changefreq: 'yearly',
    priority: 0.6,
  },
  {
    path: '/contact',
    title: `Contact ${BRAND.name} · Support, onboarding and enquiries`,
    description:
      `How to reach ${BRAND.name}: onboarding and support through your workspace administrator, privacy requests, and press or partnership enquiries.`,
    changefreq: 'yearly',
    priority: 0.6,
  },
  {
    path: '/privacy',
    title: `Privacy policy · ${BRAND.name}`,
    description:
      'How OR² handles business data: what is held, what is never collected, how it is protected and the rights your business keeps. Draft pending legal review.',
    changefreq: 'yearly',
    priority: 0.5,
  },
  {
    path: '/terms',
    title: `Terms of service · ${BRAND.name}`,
    description:
      'The terms for using an OR² workspace: eligibility, acceptable use, ownership of your records, liability and governing law. Draft pending legal review.',
    changefreq: 'yearly',
    priority: 0.5,
  },
  {
    path: '/refund-cancellation',
    title: `Cancellations and refunds · ${BRAND.name}`,
    description:
      'How an OR² access arrangement is ended, what happens to your records, and where fees, notice and refunds are set. Draft pending legal review.',
    changefreq: 'yearly',
    priority: 0.4,
  },
]

/** Page metadata for a site-relative path, or undefined when the path is unknown. */
export function pageMeta(path: string): PageEntry | undefined {
  const clean = path === '/' ? '/' : path.replace(/\/+$/, '')
  return PAGES.find((p) => p.path === clean)
}

/**
 * The date this site's content was last reviewed against the product documents.
 * Update it whenever answers, claims or legal drafts are re-checked: it is shown on
 * the FAQ and legal pages and sent to search engines as `dateModified`.
 */
export const CONTENT_REVIEWED = '2026-10-03'

export function reviewedLabel(): string {
  return new Date(`${CONTENT_REVIEWED}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Which generated social card a page uses (see scripts/make-brand-assets.mjs). */
export function ogCard(path: string): string {
  const clean = path === '/' ? '/' : path.replace(/\/+$/, '')
  if (clean === '/') return 'home'
  if (['/modules', '/pricing', '/faq', '/about', '/contact'].includes(clean)) return clean.slice(1)
  if (['/privacy', '/terms', '/refund-cancellation'].includes(clean)) return 'legal'
  return 'home'
}

/**
 * Support phone numbers, supplied by the owner. Each is both a phone line and a
 * WhatsApp number. WhatsApp links open wa.me with a short pre-filled message; they
 * are plain links, so no script or tracker is loaded from WhatsApp.
 */
export interface SupportPhone {
  /** As shown to people. */
  display: string
  /** E.164 digits with the plus, for tel: links and structured data. */
  tel: string
}

export const SUPPORT_PHONES: SupportPhone[] = [
  { display: '+91 8600527432', tel: '+918600527432' },
  { display: '+91 8412014240', tel: '+918412014240' },
]

export function whatsappUrl(phone: SupportPhone, message = 'Hi OR² team, I need help with my workspace. My business name is: '): string {
  return `https://wa.me/${phone.tel.replace('+', '')}?text=${encodeURIComponent(message)}`
}
