import type { APIRoute } from 'astro'
import { PAGES, absoluteUrl } from '../config/site'

/**
 * sitemap.xml, built from the one PAGES list so a page cannot be in the site and
 * missing from the sitemap. Generated at build time: no plugin, no dependency.
 */
export const GET: APIRoute = () => {
  const today = new Date().toISOString().slice(0, 10)
  const urls = PAGES.map((page) => {
    const loc = absoluteUrl(page.path)
    const priority = page.priority.toFixed(1)
    return [
      '  <url>',
      `    <loc>${loc}</loc>`,
      `    <lastmod>${today}</lastmod>`,
      `    <changefreq>${page.changefreq}</changefreq>`,
      `    <priority>${priority}</priority>`,
      '  </url>',
    ].join('\n')
  }).join('\n')

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n')

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}

export const prerender = true
