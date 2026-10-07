import type { APIRoute } from 'astro'
import { APP_URL, SITE_ORIGIN } from '../config/site'

/**
 * robots.txt. Only the marketing site is described here: the app is served from
 * its own path and the crawlers are pointed away from anything that is not a
 * public page. `llms.txt` is advertised, because that is what it is for.
 */
export const GET: APIRoute = () => {
  // Search engines and AI assistants are welcome on every public page. Each group is
  // listed by name so the intent is explicit; `/signup` is a placeholder and stays out.
  const crawlers = [
    'Googlebot',
    'Bingbot',
    'GPTBot',
    'OAI-SearchBot',
    'ChatGPT-User',
    'ClaudeBot',
    'Claude-SearchBot',
    'Claude-User',
    'PerplexityBot',
    'Perplexity-User',
    'Google-Extended',
    'Applebot',
  ]
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /signup',
    '',
    ...crawlers.flatMap((agent) => [`User-agent: ${agent}`, 'Allow: /', 'Disallow: /signup', '']),
    `# The logged-in application is not part of this site.`,
    `Disallow: ${APP_URL.startsWith('/') ? APP_URL : '/'}`,
    '',
    `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
    `# LLM-readable summary: ${SITE_ORIGIN}/llms.txt`,
    '',
  ].join('\n')

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export const prerender = true
