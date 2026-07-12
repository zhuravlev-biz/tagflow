import { defineConfig } from 'astro/config'

// A plain static build — no adapter needed. The Worker in ./worker serves
// the built assets via Cloudflare's static assets binding and handles the
// /go/* affiliate routes itself.
export default defineConfig({
  output: 'static',
})
