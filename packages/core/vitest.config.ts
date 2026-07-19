import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: {
        // §12: 100% branch coverage on the resolution engine is enforced.
        'src/resolve.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // Floors set just below actual post-fix coverage so this can't
        // silently regress; not 100 because a few defensive branches
        // (non-object sub-fields) aren't exercised by the test suite.
        'src/config.ts': {
          branches: 90,
          functions: 100,
          lines: 93,
          statements: 93,
        },
      },
    },
  },
})
