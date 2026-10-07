import type { APIRoute } from 'astro'
import { APP_URL, BRAND, PAGES, absoluteUrl } from '../config/site'
import { FAQ } from '../data/faq'
import { MODULE_GROUPS } from '../data/modules'

/**
 * llms.txt: a plain-text map of the site for language models and other agents.
 * Every fact here is taken from the same data files the pages render, so it cannot
 * drift. No price, no customer, no claim that is not on the pages themselves.
 */
export const GET: APIRoute = () => {
  const lines: string[] = [
    `# ${BRAND.nameFull}`,
    '',
    `> ${BRAND.name} is a web-based business-operations platform for shops, suppliers, distributors and restaurants. It combines counter billing, stock in two locations (godown and counter), purchases and supplier dues, customer khata, a cash flow register, a day book and reports in one isolated workspace per business.`,
    '',
    '## Key facts',
    '',
    `- Name: ${BRAND.name}, also written OR2 or ORSQUARE. They are the same name: one product, one company.`,
    '- Built for: retail shops, suppliers, distributors, restaurants and other businesses that buy, hold and sell goods.',
    '- Support: call or WhatsApp +91 8600527432 or +91 8412014240.',
    '- Access: by arrangement through a business administrator; there is no open self-service signup.',
    '- Pricing: Basic ₹999/month and Pro ₹1,999/month, both with a 7-day free trial; Custom (several branches, distributors) is priced on contact. Every plan includes every module. No payment is taken on the website yet.',
    '- Runs in any modern web browser. Designed so the counter can keep billing without a connection; offline bills stay provisional until confirmed.',
    '- Each business has its own isolated workspace. The site and the product use no third-party analytics or advertising trackers.',
    '- What it is not: a payroll, manufacturing or online-store system. GST return filing and e-invoicing are not described as features.',
    '',
    `The signed-in application is served separately at ${APP_URL} and is not part of this site.`,
    '',
    '## Pages',
    '',
  ]

  for (const page of PAGES) {
    lines.push(`- [${page.title}](${absoluteUrl(page.path)}): ${page.description}`)
  }

  lines.push('', '## Modules', '')
  for (const group of MODULE_GROUPS) {
    lines.push(`### ${group.heading}`, '')
    for (const module of group.modules) {
      lines.push(`- **${module.title}**: ${module.body}`)
    }
    lines.push('')
  }

  lines.push('## Frequently asked questions', '')
  for (const entry of FAQ) {
    lines.push(`### ${entry.q}`, '', entry.a, '', `Source: ${absoluteUrl('/faq')}#${entry.id}`, '')
  }

  lines.push(
    '## Notes',
    '',
    `- Legal pages (privacy, terms, cancellations and refunds) are drafts awaiting review by ${BRAND.legalName}.`,
    '- The public contact email address has not been published yet; see the contact page.',
    '- This site carries no analytics, no advertising and no third-party script, and names no',
    '  third-party software vendor. Its fonts are self-hosted.',
    '',
  )

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export const prerender = true
