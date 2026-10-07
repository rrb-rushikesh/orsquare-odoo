// @ts-check
import { defineConfig } from 'astro/config'

// The landing site is a fully static, marketing-only build. No adapter, no
// integrations, no third-party scripts: everything ships from our own origin.
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? 'https://orsquare.com',
  trailingSlash: 'never',
  build: {
    format: 'directory',
  },
  devToolbar: { enabled: false },
  compressHTML: true,
})
