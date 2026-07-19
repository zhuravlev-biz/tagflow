import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: {
        // §12: near-100% branch coverage on the resolution engine is
        // enforced. branches is 97 (actual: ~97.17%), not 100, because three
        // branches are genuinely unreachable through the public API (resolve
        // + parseConfig), even with hand-built Config objects that bypass
        // parseConfig's validation — they guard invariants only the module's
        // own private call sites already enforce:
        //  - selectVariant's `last === undefined` ternary (line ~178): dead
        //    because `entries.length > 0` is already checked above it, so
        //    `entries[entries.length - 1]` is always defined.
        //  - redirectDecision's `product.asin ?? ''` fallback (line ~295):
        //    dead because redirectDecision (not exported) is only ever
        //    called from amazonWaterfall after its own
        //    `product.asin === undefined` guard has already returned.
        //  - choiceDecision's `amazon.type === 'redirect'` check (line
        //    ~326): dead because amazonWaterfall only returns a non-redirect
        //    (not-found) Decision when product.asin is undefined, and this
        //    call site is itself guarded by `product.asin !== undefined`.
        'src/resolve.ts': {
          branches: 97,
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
