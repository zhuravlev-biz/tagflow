import type { Config, MobileDeepLink, ProductConfig, RetailerConfig, VariantConfig } from './config.js'
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
  /**
   * Device class as classified by the adapter (core does no UA parsing).
   * Only `mobile` changes behavior: it enables deep-link routing (F16).
   */
  readonly device?: 'desktop' | 'mobile' | 'bot' | undefined
  /**
   * Uniform random number in [0, 1) supplied by the adapter — core stays
   * pure (N3). Drives stateless A/B variant assignment (F13). When omitted,
   * resolution is deterministic: the first configured variant is selected.
   */
  readonly random?: number | undefined
}

export type ResolutionReason =
  | 'direct'
  | 'fallback-no-tag'
  | 'fallback-unavailable'
  | 'unknown-country'
  | 'raw-asin'
  | 'retailer'
  | 'mobile-deeplink'

/** One link on a choice page (F14). */
export interface ChoiceEntry {
  /** `amazon` for the built-in entry, otherwise the retailer key. */
  readonly key: string
  readonly label: string
  readonly url: string
}

export type Decision =
  | {
      readonly type: 'redirect'
      readonly url: string
      readonly marketplace: MarketplaceId
      readonly resolutionReason: ResolutionReason
      /** Product key in curated mode, the raw ASIN in raw mode. */
      readonly productKey: string
      /** A/B variant assigned to this click (F13), when configured. */
      readonly variant?: string
    }
  | {
      /** Non-Amazon redirect (F15/F16): tag logic bypassed by design. */
      readonly type: 'external'
      readonly url: string
      /** Retailer key, or `mobile` for a deep link. */
      readonly destination: string
      readonly resolutionReason: 'retailer' | 'mobile-deeplink'
      readonly productKey: string
    }
  | {
      /** Render a multi-retailer choice page (F14) instead of redirecting. */
      readonly type: 'choice'
      readonly productKey: string
      /** Never empty for a load-validated config. */
      readonly entries: readonly ChoiceEntry[]
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
 * any known product always terminates on a valid destination (the default
 * marketplace is validated at config-load time to carry a tag; asin-less
 * products are validated to have a catch-all retailer URL).
 *
 * The "never emit an untagged URL" guarantee (F2) is a `parseConfig`
 * contract, not something the `Config` type enforces: `resolve()` degrades
 * to an empty tag (see `redirectDecision`/`resolveRawAsin`) only for
 * hand-built `Config` values that bypass `parseConfig`'s validation.
 * Non-Amazon destinations (F15/F16) bypass tag logic by design.
 */
export function resolve(ctx: ClickContext, config: Config): Decision {
  const segments = ctx.path.split('/').filter((s) => s.length > 0)

  if (segments.length === 1 && segments[0] !== undefined) {
    const productKey = decodeSegment(segments[0])
    if (productKey === undefined) return NOT_FOUND
    return resolveCurated(productKey, ctx, config)
  }

  if (segments.length === 2 && segments[0] === 'amazon' && segments[1] !== undefined) {
    const asin = decodeSegment(segments[1])
    if (asin === undefined || !RAW_ASIN_RE.test(asin)) return NOT_FOUND
    return resolveRawAsin(asin, ctx.country, config)
  }

  return NOT_FOUND
}

/**
 * Candidate → configured fallback → default; ≤3 entries by construction.
 * Shared by curated and raw-ASIN resolution — the walk order is identical.
 */
function fallbackChain(candidate: MarketplaceId, config: Config): MarketplaceId[] {
  const chain: MarketplaceId[] = [candidate]
  const fallback = config.marketplaceFallbacks[candidate]
  if (fallback !== undefined && fallback !== candidate) chain.push(fallback)
  if (!chain.includes(config.defaultMarketplace)) chain.push(config.defaultMarketplace)
  return chain
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

/** Country-localized URL for a retailer or deep link: exact country → catch-all. */
function localizedUrl(
  dest: RetailerConfig | MobileDeepLink | undefined,
  country: string | undefined,
): string | undefined {
  if (dest === undefined) return undefined
  const byCountry = country !== undefined ? dest.urlByCountry?.[country] : undefined
  return byCountry ?? dest.url
}

/**
 * Stateless weighted variant pick (F13): walk cumulative weights against
 * `random * total`. The config object's key order fixes the walk order
 * (JS orders integer-like keys like "1" numerically before the rest, but
 * that order is still stable), so the same `random` always selects the
 * same variant.
 */
function selectVariant(
  variants: Readonly<Record<string, VariantConfig>> | undefined,
  random: number | undefined,
): { readonly name: string; readonly config: VariantConfig } | undefined {
  if (variants === undefined) return undefined
  const entries = Object.entries(variants)
  if (entries.length === 0) return undefined
  const total = entries.reduce((sum, [, v]) => sum + v.weight, 0)
  const r = random !== undefined && random >= 0 && random < 1 ? random : 0
  const target = r * total
  let cumulative = 0
  for (const [name, variant] of entries) {
    cumulative += variant.weight
    if (target < cumulative) return { name, config: variant }
  }
  // Floating-point edge (target === total): last entry.
  const last = entries[entries.length - 1]
  return last === undefined ? undefined : { name: last[0], config: last[1] }
}

function resolveCurated(productKey: string, ctx: ClickContext, config: Config): Decision {
  const product = config.products[productKey]
  if (product === undefined) return NOT_FOUND

  const country = ctx.country?.toUpperCase()

  // F16: a configured mobile deep link wins for mobile visitors — it exists
  // precisely to short-circuit the web flow. Opportunistic: no URL for this
  // country → fall through to normal resolution.
  if (ctx.device === 'mobile') {
    const deepLink = localizedUrl(product.deepLinks?.mobile, country)
    if (deepLink !== undefined) {
      return {
        type: 'external',
        url: deepLink,
        destination: 'mobile',
        resolutionReason: 'mobile-deeplink',
        productKey,
      }
    }
  }

  // F14: choice page instead of a redirect. Variants deliberately do not
  // apply here — a choice view is not a destination assignment.
  if (product.choice === true) {
    return choiceDecision(product, productKey, country, config)
  }

  // F15: non-Amazon primary destination; falls back to the Amazon waterfall
  // when the retailer has no URL for this country (asin validated present
  // in that case).
  const destination = product.destination ?? 'amazon'
  if (destination !== 'amazon') {
    const url = localizedUrl(product.retailers?.[destination], country)
    if (url !== undefined) {
      return { type: 'external', url, destination, resolutionReason: 'retailer', productKey }
    }
  }

  return amazonWaterfall(product, productKey, country, ctx.random, config)
}

/**
 * The tag/availability waterfall (F1–F5) with A/B variant overlay (F13).
 * A variant's `asin`/`asinByMarketplace` replace the base fields wholesale —
 * see `VariantConfig`.
 */
function amazonWaterfall(
  product: ProductConfig,
  productKey: string,
  country: string | undefined,
  random: number | undefined,
  config: Config,
): Decision {
  // Unreachable with a load-validated config: an asin-less product always
  // has a catch-all retailer destination or choice page. Total anyway.
  if (product.asin === undefined) return NOT_FOUND

  const variant = selectVariant(product.variants, random)
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

  const chain = fallbackChain(candidate, config)

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
    return redirectDecision(product, productKey, marketplace, reason, variant, config)
  }

  // Unreachable with a load-validated config (the default marketplace always
  // has a tag and skips the availability gate) — but resolution must be
  // total, so degrade to the default marketplace rather than throw.
  return redirectDecision(
    product,
    productKey,
    config.defaultMarketplace,
    firstFailure === 'unavailable' ? 'fallback-unavailable' : 'fallback-no-tag',
    variant,
    config,
  )
}

function redirectDecision(
  product: ProductConfig,
  productKey: string,
  marketplace: MarketplaceId,
  resolutionReason: ResolutionReason,
  variant: { readonly name: string; readonly config: VariantConfig } | undefined,
  config: Config,
): Decision {
  const baseAsin = variant?.config.asin ?? product.asin ?? ''
  const asinByMarketplace =
    variant?.config.asinByMarketplace !== undefined
      ? variant.config.asinByMarketplace
      : product.asinByMarketplace
  const asin = asinByMarketplace?.[marketplace] ?? baseAsin
  const tag = config.tags[marketplace] ?? config.tags[config.defaultMarketplace] ?? ''
  return {
    type: 'redirect',
    url: taggedUrl(marketplace, asin, tag),
    marketplace,
    resolutionReason,
    productKey,
    ...(variant !== undefined ? { variant: variant.name } : {}),
  }
}

/**
 * Choice page entries (F14): Amazon (tag waterfall, no variant assignment)
 * when the product has an ASIN, plus every retailer with a URL for the
 * visitor's country. Never empty for a load-validated config.
 */
function choiceDecision(
  product: ProductConfig,
  productKey: string,
  country: string | undefined,
  config: Config,
): Decision {
  const entries: ChoiceEntry[] = []
  if (product.asin !== undefined) {
    const amazon = amazonWaterfall(product, productKey, country, undefined, config)
    if (amazon.type === 'redirect') {
      entries.push({ key: 'amazon', label: 'Amazon', url: amazon.url })
    }
  }
  for (const [key, retailer] of Object.entries(product.retailers ?? {})) {
    const url = localizedUrl(retailer, country)
    if (url !== undefined) {
      entries.push({ key, label: retailer.label, url })
    }
  }
  return { type: 'choice', productKey, entries }
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
    const chain = fallbackChain(candidate, config)
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
