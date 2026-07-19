import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// §12: runs the suite inside the real Workers runtime (workerd) via
// Miniflare, instead of hand-mocked Request/cf/ctx objects. No wrangler
// config is needed — the package has no bindings of its own; tests inject
// fake AnalyticsEngineDataset-shaped objects as `env` directly, exactly as a
// mounting host Worker would.
export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2025-01-01',
      },
    }),
  ],
})
