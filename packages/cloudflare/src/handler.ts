import {
  parseConfig,
  resolve,
  type Config,
  type Decision,
} from '@tagflow/core'
import type {
  AnalyticsEngineDataset,
  ExecutionContextLike,
  IncomingRequest,
  UaClass,
} from './types.js'
import { classifyUserAgent } from './ua.js'

export interface AffiliateHandlerOptions {
  /** Route prefix the handler owns. Default: `/go`. */
  readonly prefix?: string
  /** Name of the Analytics Engine binding on `env`. Default: `CLICKS`. */
  readonly analyticsBinding?: string
  /**
   * Bot policy: `redirect` (default) redirects and logs with `uaClass=bot`;
   * `ignore` redirects but skips logging.
   */
  readonly bots?: 'redirect' | 'ignore'
}

export type AffiliateHandler = (
  request: Request,
  // `unknown` so any generated Env interface is accepted without casts.
  env: unknown,
  ctx: ExecutionContextLike,
) => Promise<Response | null>

/**
 * Build the mountable handler (F7). Returns a `Response` for paths under the
 * prefix and `null` otherwise — including for unknown product keys — so a
 * host Worker can fall through to `env.ASSETS.fetch(request)` (or the
 * standalone wrapper to its JSON 404).
 *
 * Accepts either raw JSON or an already-parsed `Config`; either way it is
 * validated here, at startup — never per request.
 */
export function createAffiliateHandler(
  config: unknown,
  options: AffiliateHandlerOptions = {},
): AffiliateHandler {
  const parsed = toConfig(config)
  const rawPrefix = options.prefix ?? '/go'
  const prefix = `/${rawPrefix.replace(/^\/+|\/+$/g, '')}`
  const analyticsBinding = options.analyticsBinding ?? 'CLICKS'
  const bots = options.bots ?? 'redirect'

  return async (request, env, ctx) => {
    const url = new URL(request.url)
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
      return null
    }

    // Uppercased once here so the value logged to Analytics Engine matches
    // what `resolve()` normalizes to internally (`resolve` re-uppercases
    // idempotently, so passing the normalized value through is safe).
    const country = (request as IncomingRequest).cf?.country?.toUpperCase()
    const userAgent = request.headers.get('user-agent')
    const decision = resolve(
      { country, path: url.pathname.slice(prefix.length), userAgent: userAgent ?? undefined },
      parsed,
    )
    if (decision.type === 'not-found') return null

    // Redirect first; log via waitUntil so analytics can never delay or
    // fail the visitor (F11). Only GET is logged as a click — HEAD/OPTIONS/
    // POST etc. are prefetch or preflight noise, not visitor clicks, and
    // would otherwise inflate the analytics counts.
    const uaClass = classifyUserAgent(userAgent)
    if (request.method === 'GET' && (bots !== 'ignore' || uaClass !== 'bot')) {
      const dataset = (env as Record<string, unknown> | null | undefined)?.[analyticsBinding]
      if (isAnalyticsDataset(dataset)) {
        try {
          ctx.waitUntil(logClick(dataset, decision, country, uaClass))
        } catch {
          // Even a broken ExecutionContext must not break the redirect.
        }
      }
    }

    // 302, not 301: mappings and tags change. `no-store`: the response is
    // geo-dependent. `noindex`: redirect paths must never enter search
    // indexes (F9/N5). Referrer policy is deliberately left at the browser
    // default so Amazon sees the linking origin (compliance, §11).
    return new Response(null, {
      status: 302,
      headers: {
        location: decision.url,
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex',
      },
    })
  }
}

function toConfig(config: unknown): Config {
  // Always re-validate, even if `config` is already a parsed `Config` — this
  // runs once at startup, never per request, so the cost is negligible, and
  // skipping it (e.g. via a shape-sniffing heuristic) previously let raw
  // JSON in the documented schema shape bypass validation entirely.
  const result = parseConfig(config)
  if (!result.ok) {
    const details = result.errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')
    throw new Error(`[tagflow] invalid affiliate config:\n${details}`)
  }
  for (const warning of result.warnings) {
    console.warn(`[tagflow] config warning at ${warning.path}: ${warning.message}`)
  }
  return result.config
}

function isAnalyticsDataset(value: unknown): value is AnalyticsEngineDataset {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AnalyticsEngineDataset).writeDataPoint === 'function'
  )
}

function logClick(
  dataset: AnalyticsEngineDataset,
  decision: Extract<Decision, { type: 'redirect' }>,
  country: string | undefined,
  uaClass: UaClass,
): Promise<void> {
  return Promise.resolve().then(() => {
    try {
      dataset.writeDataPoint({
        blobs: [
          country ?? '',
          decision.marketplace,
          decision.productKey,
          decision.resolutionReason,
          uaClass,
        ],
        doubles: [1],
        indexes: [decision.productKey],
      })
    } catch {
      // Analytics errors are invisible to the visitor by design (F11).
    }
  })
}
