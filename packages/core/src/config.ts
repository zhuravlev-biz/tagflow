import { ISO_3166_ALPHA2 } from './country-map.js'
import { isMarketplaceId, MARKETPLACE_IDS, type MarketplaceId } from './marketplaces.js'

export interface ProductConfig {
  /** Base ASIN, used wherever no per-marketplace override exists. */
  readonly asin: string
  /** Per-marketplace ASIN overrides (third-party listings differ per storefront). */
  readonly asinByMarketplace?: Readonly<Partial<Record<MarketplaceId, string>>>
  /**
   * Marketplaces where the listing is known to exist. Absence means
   * "fall back", not "guess". The default marketplace is always assumed
   * available and does not need to be listed.
   */
  readonly availableIn?: readonly MarketplaceId[]
}

export interface Config {
  readonly defaultMarketplace: MarketplaceId
  readonly tags: Readonly<Partial<Record<MarketplaceId, string>>>
  readonly countryOverrides: Readonly<Partial<Record<string, MarketplaceId>>>
  readonly marketplaceFallbacks: Readonly<Partial<Record<MarketplaceId, MarketplaceId>>>
  readonly unknownAsin: 'geo' | 'default'
  readonly products: Readonly<Record<string, ProductConfig>>
}

export interface ValidationIssue {
  /** JSON-path-ish location, e.g. `products.flagship-product.availableIn[2]`. */
  readonly path: string
  readonly message: string
}

export type ParseConfigResult =
  | { readonly ok: true; readonly config: Config; readonly warnings: readonly ValidationIssue[] }
  | { readonly ok: false; readonly errors: readonly ValidationIssue[] }

/** Route segments that product keys must not collide with. */
export const RESERVED_PRODUCT_KEYS: readonly string[] = ['amazon']

const PRODUCT_KEY_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._~-]*[A-Za-z0-9])?$/
const ASIN_RE = /^[A-Z0-9]{10}$/
/** Common Associates tag shape: `something-NN`. Deviations warn, never block. */
const TAG_SHAPE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*-\d{2,3}$/

const ISO_SET: ReadonlySet<string> = new Set(ISO_3166_ALPHA2)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate raw JSON into a `Config`. Errors are precise and fail the parse;
 * warnings flag suspicious-but-legal values (tag shape, unknown country
 * codes) and never block.
 */
export function parseConfig(input: unknown): ParseConfigResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const err = (path: string, message: string): void => {
    errors.push({ path, message })
  }
  const warn = (path: string, message: string): void => {
    warnings.push({ path, message })
  }

  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: '', message: 'config must be a JSON object' }] }
  }

  // defaultMarketplace
  const defaultMarketplace = input['defaultMarketplace']
  if (!isMarketplaceId(defaultMarketplace)) {
    err(
      'defaultMarketplace',
      `must be one of: ${MARKETPLACE_IDS.join(', ')} (got ${JSON.stringify(defaultMarketplace)})`,
    )
  }

  // tags
  const tags: Partial<Record<MarketplaceId, string>> = {}
  const rawTags = input['tags']
  if (!isRecord(rawTags)) {
    err('tags', 'must be an object mapping marketplace → affiliate tag')
  } else {
    for (const [marketplace, tag] of Object.entries(rawTags)) {
      const path = `tags.${marketplace}`
      if (!isMarketplaceId(marketplace)) {
        err(path, `unknown marketplace ${JSON.stringify(marketplace)}`)
        continue
      }
      if (typeof tag !== 'string' || tag.length === 0) {
        err(path, 'affiliate tag must be a non-empty string')
        continue
      }
      if (!TAG_SHAPE_RE.test(tag)) {
        warn(
          path,
          `${JSON.stringify(tag)} does not look like a typical Associates tag (expected e.g. "yourtag-21"); double-check it`,
        )
      }
      tags[marketplace] = tag
    }
  }

  if (
    isMarketplaceId(defaultMarketplace) &&
    isRecord(rawTags) &&
    tags[defaultMarketplace] === undefined
  ) {
    err(
      'defaultMarketplace',
      `default marketplace "${defaultMarketplace}" has no affiliate tag in "tags" — the fallback chain must always terminate on a tagged marketplace`,
    )
  }

  // countryOverrides
  const countryOverrides: Partial<Record<string, MarketplaceId>> = {}
  const rawOverrides = input['countryOverrides'] ?? {}
  if (!isRecord(rawOverrides)) {
    err('countryOverrides', 'must be an object mapping ISO country code → marketplace')
  } else {
    for (const [country, marketplace] of Object.entries(rawOverrides)) {
      const path = `countryOverrides.${country}`
      if (!/^[A-Z]{2}$/.test(country)) {
        err(path, 'country codes must be two uppercase letters (ISO 3166-1 alpha-2)')
        continue
      }
      if (!ISO_SET.has(country)) {
        warn(path, `${JSON.stringify(country)} is not an assigned ISO 3166-1 alpha-2 code`)
      }
      if (!isMarketplaceId(marketplace)) {
        err(path, `unknown marketplace ${JSON.stringify(marketplace)}`)
        continue
      }
      countryOverrides[country] = marketplace
    }
  }

  // marketplaceFallbacks
  const marketplaceFallbacks: Partial<Record<MarketplaceId, MarketplaceId>> = {}
  const rawFallbacks = input['marketplaceFallbacks'] ?? {}
  if (!isRecord(rawFallbacks)) {
    err('marketplaceFallbacks', 'must be an object mapping marketplace → fallback marketplace')
  } else {
    for (const [from, to] of Object.entries(rawFallbacks)) {
      const path = `marketplaceFallbacks.${from}`
      if (!isMarketplaceId(from)) {
        err(path, `unknown marketplace ${JSON.stringify(from)}`)
        continue
      }
      if (!isMarketplaceId(to)) {
        err(path, `unknown fallback marketplace ${JSON.stringify(to)}`)
        continue
      }
      if (from === to) {
        err(path, 'a marketplace cannot fall back to itself')
        continue
      }
      marketplaceFallbacks[from] = to
    }
    // Reject cycles (a → b, b → a). Resolution only ever takes one fallback
    // hop, but a cyclic config is always a mistake worth failing loudly on.
    for (const start of Object.keys(marketplaceFallbacks) as MarketplaceId[]) {
      const seen = new Set<MarketplaceId>([start])
      let current = marketplaceFallbacks[start]
      while (current !== undefined) {
        if (seen.has(current)) {
          err(
            `marketplaceFallbacks.${start}`,
            `fallback chain starting at "${start}" is cyclic`,
          )
          break
        }
        seen.add(current)
        current = marketplaceFallbacks[current]
      }
    }
  }

  // unknownAsin
  const unknownAsin = input['unknownAsin'] ?? 'default'
  if (unknownAsin !== 'geo' && unknownAsin !== 'default') {
    err('unknownAsin', `must be "geo" or "default" (got ${JSON.stringify(unknownAsin)})`)
  }

  // products
  const products: Record<string, ProductConfig> = {}
  const rawProducts = input['products'] ?? {}
  if (!isRecord(rawProducts)) {
    err('products', 'must be an object mapping product key → product entry')
  } else {
    for (const [key, rawProduct] of Object.entries(rawProducts)) {
      const path = `products.${key}`
      if (RESERVED_PRODUCT_KEYS.includes(key.toLowerCase())) {
        err(path, `"${key}" is a reserved route segment and cannot be a product key`)
        continue
      }
      if (!PRODUCT_KEY_RE.test(key)) {
        err(
          path,
          'product keys must be URL-safe: letters, digits, ".", "_", "~", "-" (must start and end alphanumeric)',
        )
        continue
      }
      if (!isRecord(rawProduct)) {
        err(path, 'must be an object with at least an "asin"')
        continue
      }

      const asin = rawProduct['asin']
      if (typeof asin !== 'string' || asin.length === 0) {
        err(`${path}.asin`, 'must be a non-empty string')
        continue
      }
      if (!ASIN_RE.test(asin)) {
        warn(`${path}.asin`, `${JSON.stringify(asin)} does not look like an ASIN (10 chars, A–Z/0–9)`)
      }

      const asinByMarketplace: Partial<Record<MarketplaceId, string>> = {}
      const rawAsinBy = rawProduct['asinByMarketplace'] ?? {}
      if (!isRecord(rawAsinBy)) {
        err(`${path}.asinByMarketplace`, 'must be an object mapping marketplace → ASIN')
      } else {
        for (const [marketplace, override] of Object.entries(rawAsinBy)) {
          const overridePath = `${path}.asinByMarketplace.${marketplace}`
          if (!isMarketplaceId(marketplace)) {
            err(overridePath, `unknown marketplace ${JSON.stringify(marketplace)}`)
            continue
          }
          if (typeof override !== 'string' || override.length === 0) {
            err(overridePath, 'must be a non-empty string')
            continue
          }
          if (!ASIN_RE.test(override)) {
            warn(overridePath, `${JSON.stringify(override)} does not look like an ASIN`)
          }
          asinByMarketplace[marketplace] = override
        }
      }

      const availableIn: MarketplaceId[] = []
      const rawAvailableIn = rawProduct['availableIn'] ?? []
      if (!Array.isArray(rawAvailableIn)) {
        err(`${path}.availableIn`, 'must be an array of marketplace ids')
      } else {
        rawAvailableIn.forEach((marketplace, index) => {
          if (!isMarketplaceId(marketplace)) {
            err(`${path}.availableIn[${index}]`, `unknown marketplace ${JSON.stringify(marketplace)}`)
            return
          }
          availableIn.push(marketplace)
        })
      }

      products[key] = { asin, asinByMarketplace, availableIn }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    config: {
      defaultMarketplace: defaultMarketplace as MarketplaceId,
      tags,
      countryOverrides,
      marketplaceFallbacks,
      unknownAsin: unknownAsin as 'geo' | 'default',
      products,
    },
    warnings,
  }
}
