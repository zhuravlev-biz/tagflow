import type { Config } from './config.js'
import { marketplaceForCountry } from './country-map.js'
import { AMAZON_DOMAINS, type MarketplaceId } from './marketplaces.js'

/**
 * Everything `resolve()` is allowed to know about a click. `path` is the
 * pathname *relative to the mount prefix* (the adapter strips the prefix),
 * e.g. `/flagship-product` or `/amazon/B0XXXXXXXX`.
 */
export interface ClickContext {
  readonly country?: string | undefined
  readonly path: string
  readonly userAgent?: string | undefined
}

export type ResolutionReason =
  | 'direct'
  | 'fallback-no-tag'
  | 'fallback-unavailable'
  | 'unknown-country'
  | 'raw-asin'

export type Decision =
  | {
      readonly type: 'redirect'
      readonly url: string
      readonly marketplace: MarketplaceId
      readonly resolutionReason: ResolutionReason
      /** Product key in curated mode, the raw ASIN in raw mode. */
      readonly productKey: string
    }
  | { readonly type: 'not-found' }

const NOT_FOUND: Decision = { type: 'not-found' }
const RAW_ASIN_RE = /^[A-Za-z0-9]{10}$/

function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

function taggedUrl(marketplace: MarketplaceId, asin: string, tag: string): string {
  return `https://${AMAZON_DOMAINS[marketplace]}/dp/${encodeURIComponent(asin)}?tag=${encodeURIComponent(tag)}`
}

/**
 * Pure, total resolution: same input → same output, never throws, and for
 * any known product always terminates on a tagged URL (the default
 * marketplace is validated at config-load time to carry a tag).
 */
export function resolve(ctx: ClickContext, config: Config): Decision {
  const segments = ctx.path.split('/').filter((s) => s.length > 0)

  if (segments.length === 1 && segments[0] !== undefined) {
    const productKey = decodeSegment(segments[0])
    if (productKey === undefined) return NOT_FOUND
    return resolveCurated(productKey, ctx.country, config)
  }

  if (segments.length === 2 && segments[0] === 'amazon' && segments[1] !== undefined) {
    const asin = decodeSegment(segments[1])
    if (asin === undefined || !RAW_ASIN_RE.test(asin)) return NOT_FOUND
    return resolveRawAsin(asin, ctx.country, config)
  }

  return NOT_FOUND
}

/**
 * Candidate marketplace for a country: config override → built-in curated
 * map → default. Returns the reason alongside so `unknown-country` is
 * reported even when every gate passes.
 */
function candidateForCountry(
  country: string | undefined,
  config: Config,
): { marketplace: MarketplaceId; unknownCountry: boolean } {
  const normalized = country?.toUpperCase()
  const overridden = normalized !== undefined ? config.countryOverrides[normalized] : undefined
  const mapped = overridden ?? marketplaceForCountry(normalized)
  if (mapped !== undefined) return { marketplace: mapped, unknownCountry: false }
  return { marketplace: config.defaultMarketplace, unknownCountry: true }
}

function resolveCurated(
  productKey: string,
  country: string | undefined,
  config: Config,
): Decision {
  const product = config.products[productKey]
  if (product === undefined) return NOT_FOUND

  const { marketplace: candidate, unknownCountry } = candidateForCountry(country, config)

  // Gate: a marketplace passes if it has a tag AND the product is listed
  // there. The default marketplace skips the availability gate — products
  // are assumed available there (F3/F5).
  const availability = new Set(product.availableIn ?? [])
  const failureOf = (marketplace: MarketplaceId): 'no-tag' | 'unavailable' | undefined => {
    if (config.tags[marketplace] === undefined) return 'no-tag'
    if (marketplace !== config.defaultMarketplace && !availability.has(marketplace)) {
      return 'unavailable'
    }
    return undefined
  }

  // Walk candidate → configured fallback → default; ≤3 hops by construction.
  const chain: MarketplaceId[] = [candidate]
  const fallback = config.marketplaceFallbacks[candidate]
  if (fallback !== undefined && fallback !== candidate) chain.push(fallback)
  if (!chain.includes(config.defaultMarketplace)) chain.push(config.defaultMarketplace)

  let firstFailure: 'no-tag' | 'unavailable' | undefined
  for (const marketplace of chain) {
    const failure = failureOf(marketplace)
    if (failure !== undefined) {
      firstFailure ??= failure
      continue
    }
    const reason: ResolutionReason =
      firstFailure === 'no-tag'
        ? 'fallback-no-tag'
        : firstFailure === 'unavailable'
          ? 'fallback-unavailable'
          : unknownCountry
            ? 'unknown-country'
            : 'direct'
    return redirectDecision(product, productKey, marketplace, reason, config)
  }

  // Unreachable with a load-validated config (the default marketplace always
  // has a tag and skips the availability gate) — but resolution must be
  // total, so degrade to the default marketplace rather than throw.
  return redirectDecision(
    product,
    productKey,
    config.defaultMarketplace,
    firstFailure === 'unavailable' ? 'fallback-unavailable' : 'fallback-no-tag',
    config,
  )
}

function redirectDecision(
  product: Config['products'][string],
  productKey: string,
  marketplace: MarketplaceId,
  resolutionReason: ResolutionReason,
  config: Config,
): Decision {
  const asin = product.asinByMarketplace?.[marketplace] ?? product.asin
  const tag = config.tags[marketplace] ?? config.tags[config.defaultMarketplace] ?? ''
  return { type: 'redirect', url: taggedUrl(marketplace, asin, tag), marketplace, resolutionReason, productKey }
}

function resolveRawAsin(
  asin: string,
  country: string | undefined,
  config: Config,
): Decision {
  const normalizedAsin = asin.toUpperCase()

  let marketplace: MarketplaceId
  if (config.unknownAsin === 'geo') {
    // Geo chain with the tag gate only — availability is unknown by
    // definition, so it cannot gate (F6).
    const { marketplace: candidate } = candidateForCountry(country, config)
    const chain: MarketplaceId[] = [candidate]
    const fallback = config.marketplaceFallbacks[candidate]
    if (fallback !== undefined && fallback !== candidate) chain.push(fallback)
    if (!chain.includes(config.defaultMarketplace)) chain.push(config.defaultMarketplace)
    marketplace = chain.find((m) => config.tags[m] !== undefined) ?? config.defaultMarketplace
  } else {
    marketplace = config.defaultMarketplace
  }

  const tag = config.tags[marketplace] ?? ''
  return {
    type: 'redirect',
    url: taggedUrl(marketplace, normalizedAsin, tag),
    marketplace,
    resolutionReason: 'raw-asin',
    productKey: normalizedAsin,
  }
}
