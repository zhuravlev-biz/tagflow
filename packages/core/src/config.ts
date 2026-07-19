import { ISO_3166_ALPHA2 } from './country-map.js'
import { isMarketplaceId, MARKETPLACE_IDS, type MarketplaceId } from './marketplaces.js'

/**
 * A weighted A/B variant (F13). A variant that provides `asin` replaces the
 * base ASIN; a variant that provides `asinByMarketplace` replaces the base
 * map wholesale (no per-key merge — mixing a variant's base ASIN with the
 * base product's per-marketplace overrides would pair unrelated listings).
 */
export interface VariantConfig {
  /** Relative weight (> 0); weights need not sum to any particular total. */
  readonly weight: number
  readonly asin?: string
  readonly asinByMarketplace?: Readonly<Partial<Record<MarketplaceId, string>>>
}

/**
 * A non-Amazon destination (F15): a catch-all `url`, per-country overrides,
 * or both. At least one must be present.
 */
export interface RetailerConfig {
  /** Display name, used on choice pages (F14). */
  readonly label: string
  /** Catch-all URL when no per-country entry matches. */
  readonly url?: string
  /** ISO 3166-1 alpha-2 country → URL. */
  readonly urlByCountry?: Readonly<Partial<Record<string, string>>>
}

/**
 * Mobile deep link (F16). App-scheme URLs (`myapp://…`) are allowed —
 * these are exactly the URLs deep links exist for.
 */
export interface MobileDeepLink {
  readonly url?: string
  readonly urlByCountry?: Readonly<Partial<Record<string, string>>>
}

export interface ProductConfig {
  /**
   * Base ASIN, used wherever no per-marketplace override exists. Optional
   * only when `destination` names a retailer with a catch-all `url` —
   * otherwise resolution could not terminate for every country.
   */
  readonly asin?: string
  /** Per-marketplace ASIN overrides (third-party listings differ per storefront). */
  readonly asinByMarketplace?: Readonly<Partial<Record<MarketplaceId, string>>>
  /**
   * Marketplaces where the listing is known to exist. Absence means
   * "fall back", not "guess". The default marketplace is always assumed
   * available and does not need to be listed.
   */
  readonly availableIn?: readonly MarketplaceId[]
  /** Weighted A/B variants (F13); stateless assignment per click. */
  readonly variants?: Readonly<Record<string, VariantConfig>>
  /** Non-Amazon retailers (F15); also the entries of a choice page (F14). */
  readonly retailers?: Readonly<Record<string, RetailerConfig>>
  /**
   * Where `/go/<key>` routes: `"amazon"` (default, the tag waterfall) or a
   * key from `retailers`. A retailer destination with no URL for the
   * visitor's country falls back to the Amazon waterfall.
   */
  readonly destination?: string
  /**
   * Render a multi-retailer choice page (F14) instead of redirecting:
   * one entry per retailer with a URL for the visitor's country, plus
   * Amazon (tag waterfall) when `asin` is set.
   */
  readonly choice?: boolean
  /** Device-conditional routing (F16). */
  readonly deepLinks?: {
    /** Where mobile visitors go instead, when a URL resolves for them. */
    readonly mobile?: MobileDeepLink
  }
}

/**
 * The "never emit an untagged URL" guarantee (F2) is enforced by
 * `parseConfig` (it rejects a default marketplace with no tag) — it is not a
 * property of this type. A hand-built `Config` that bypasses `parseConfig`
 * can violate it, in which case `resolve()` degrades to an empty tag rather
 * than throwing.
 */
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

/** Absolute http(s) URL with a non-empty host. */
const WEB_URL_RE = /^https?:\/\/[^\s/?#]+/i
/** Any absolute URL: RFC 3986 scheme followed by ":" and a non-space body. */
const ANY_SCHEME_URL_RE = /^[a-z][a-z0-9+.-]*:\S+$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type IssueSink = (path: string, message: string) => void

function parseAsinByMarketplace(
  raw: unknown,
  path: string,
  err: IssueSink,
  warn: IssueSink,
): Partial<Record<MarketplaceId, string>> {
  const result: Partial<Record<MarketplaceId, string>> = {}
  const value = raw ?? {}
  if (!isRecord(value)) {
    err(path, 'must be an object mapping marketplace → ASIN')
    return result
  }
  for (const [marketplace, override] of Object.entries(value)) {
    const overridePath = `${path}.${marketplace}`
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
    result[marketplace] = override
  }
  return result
}

/**
 * Validate a destination URL. `web` mode requires http(s) (retailer links a
 * browser must be able to open); `any` mode also accepts app schemes like
 * `myapp://…` (mobile deep links, F16).
 */
function parseDestinationUrl(
  raw: unknown,
  path: string,
  mode: 'web' | 'any',
  err: IssueSink,
  warn: IssueSink,
): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string' || raw.length === 0) {
    err(path, 'must be a non-empty URL string')
    return undefined
  }
  // core is platform-free (no `URL` global in its ES2022 lib), so URL sanity
  // is a scheme check, not a full parse.
  if (mode === 'web') {
    if (!WEB_URL_RE.test(raw)) {
      err(path, `${JSON.stringify(raw)} is not an absolute http(s) URL`)
      return undefined
    }
    if (raw.toLowerCase().startsWith('http:')) {
      warn(path, 'http:// destination — prefer https://')
    }
    return raw
  }
  if (!ANY_SCHEME_URL_RE.test(raw)) {
    err(path, `${JSON.stringify(raw)} is not an absolute URL (missing scheme)`)
    return undefined
  }
  return raw
}

function parseUrlByCountry(
  raw: unknown,
  path: string,
  mode: 'web' | 'any',
  err: IssueSink,
  warn: IssueSink,
): Partial<Record<string, string>> {
  const result: Partial<Record<string, string>> = {}
  if (raw === undefined) return result
  if (!isRecord(raw)) {
    err(path, 'must be an object mapping ISO country code → URL')
    return result
  }
  for (const [country, url] of Object.entries(raw)) {
    const entryPath = `${path}.${country}`
    if (!/^[A-Z]{2}$/.test(country)) {
      err(entryPath, 'country codes must be two uppercase letters (ISO 3166-1 alpha-2)')
      continue
    }
    if (!ISO_SET.has(country)) {
      warn(entryPath, `${JSON.stringify(country)} is not an assigned ISO 3166-1 alpha-2 code`)
    }
    const validated = parseDestinationUrl(url, entryPath, mode, err, warn)
    if (validated !== undefined) {
      result[country] = validated
    }
  }
  return result
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
    // `reported` tracks every node already accounted for by a reported cycle
    // so a 2-cycle like {de: 'fr', fr: 'de'} is flagged once, not twice.
    const reported = new Set<MarketplaceId>()
    for (const start of Object.keys(marketplaceFallbacks) as MarketplaceId[]) {
      if (reported.has(start)) continue
      const seen = new Set<MarketplaceId>([start])
      let current = marketplaceFallbacks[start]
      while (current !== undefined) {
        if (seen.has(current)) {
          err(
            `marketplaceFallbacks.${start}`,
            `fallback chain starting at "${start}" is cyclic`,
          )
          for (const node of seen) reported.add(node)
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

      const rawAsin = rawProduct['asin']
      let asin: string | undefined
      if (rawAsin !== undefined) {
        if (typeof rawAsin !== 'string' || rawAsin.length === 0) {
          err(`${path}.asin`, 'must be a non-empty string')
          continue
        }
        asin = rawAsin
        if (!ASIN_RE.test(asin)) {
          warn(`${path}.asin`, `${JSON.stringify(asin)} does not look like an ASIN (10 chars, A–Z/0–9)`)
        }
      }

      const asinByMarketplace = parseAsinByMarketplace(
        rawProduct['asinByMarketplace'],
        `${path}.asinByMarketplace`,
        err,
        warn,
      )

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

      // variants (F13)
      const variants: Record<string, VariantConfig> = {}
      const rawVariants = rawProduct['variants']
      if (rawVariants !== undefined) {
        if (!isRecord(rawVariants)) {
          err(`${path}.variants`, 'must be an object mapping variant name → { weight, asin?, asinByMarketplace? }')
        } else {
          for (const [name, rawVariant] of Object.entries(rawVariants)) {
            const variantPath = `${path}.variants.${name}`
            if (!PRODUCT_KEY_RE.test(name)) {
              err(
                variantPath,
                'variant names must be URL-safe: letters, digits, ".", "_", "~", "-" (must start and end alphanumeric)',
              )
              continue
            }
            if (!isRecord(rawVariant)) {
              err(variantPath, 'must be an object with at least a positive "weight"')
              continue
            }
            const weight = rawVariant['weight']
            if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
              err(`${variantPath}.weight`, 'must be a finite number greater than 0')
              continue
            }
            const rawVariantAsin = rawVariant['asin']
            let variantAsin: string | undefined
            if (rawVariantAsin !== undefined) {
              if (typeof rawVariantAsin !== 'string' || rawVariantAsin.length === 0) {
                err(`${variantPath}.asin`, 'must be a non-empty string')
                continue
              }
              variantAsin = rawVariantAsin
              if (!ASIN_RE.test(variantAsin)) {
                warn(`${variantPath}.asin`, `${JSON.stringify(variantAsin)} does not look like an ASIN`)
              }
            }
            const variantAsinBy = parseAsinByMarketplace(
              rawVariant['asinByMarketplace'],
              `${variantPath}.asinByMarketplace`,
              err,
              warn,
            )
            variants[name] = {
              weight,
              ...(variantAsin !== undefined ? { asin: variantAsin } : {}),
              ...(rawVariant['asinByMarketplace'] !== undefined
                ? { asinByMarketplace: variantAsinBy }
                : {}),
            }
          }
          if (Object.keys(variants).length === 1) {
            warn(
              `${path}.variants`,
              'only one variant configured — every click gets it, which measures nothing',
            )
          }
          if (Object.keys(variants).length > 0 && asin === undefined) {
            err(`${path}.variants`, 'variants adjust Amazon ASINs and require a base "asin"')
          }
        }
      }

      // retailers (F15)
      const retailers: Record<string, RetailerConfig> = {}
      const rawRetailers = rawProduct['retailers']
      if (rawRetailers !== undefined) {
        if (!isRecord(rawRetailers)) {
          err(
            `${path}.retailers`,
            'must be an object mapping retailer key → { label, url?, urlByCountry? }',
          )
        } else {
          for (const [retailerKey, rawRetailer] of Object.entries(rawRetailers)) {
            const retailerPath = `${path}.retailers.${retailerKey}`
            if (retailerKey.toLowerCase() === 'amazon') {
              err(retailerPath, '"amazon" is reserved for the built-in Amazon entry')
              continue
            }
            if (!PRODUCT_KEY_RE.test(retailerKey)) {
              err(
                retailerPath,
                'retailer keys must be URL-safe: letters, digits, ".", "_", "~", "-" (must start and end alphanumeric)',
              )
              continue
            }
            if (!isRecord(rawRetailer)) {
              err(retailerPath, 'must be an object with a "label" and a "url" and/or "urlByCountry"')
              continue
            }
            const label = rawRetailer['label']
            if (typeof label !== 'string' || label.length === 0) {
              err(`${retailerPath}.label`, 'must be a non-empty string')
              continue
            }
            const url = parseDestinationUrl(rawRetailer['url'], `${retailerPath}.url`, 'web', err, warn)
            const urlByCountry = parseUrlByCountry(
              rawRetailer['urlByCountry'],
              `${retailerPath}.urlByCountry`,
              'web',
              err,
              warn,
            )
            if (url === undefined && Object.keys(urlByCountry).length === 0) {
              err(retailerPath, 'needs a catch-all "url" and/or at least one "urlByCountry" entry')
              continue
            }
            retailers[retailerKey] = {
              label,
              ...(url !== undefined ? { url } : {}),
              ...(rawRetailer['urlByCountry'] !== undefined ? { urlByCountry } : {}),
            }
          }
        }
      }

      // destination (F15)
      const rawDestination = rawProduct['destination']
      let destination: string | undefined
      if (rawDestination !== undefined) {
        if (typeof rawDestination !== 'string') {
          err(`${path}.destination`, 'must be "amazon" or a key from this product\'s "retailers"')
        } else if (rawDestination !== 'amazon' && retailers[rawDestination] === undefined) {
          err(
            `${path}.destination`,
            `${JSON.stringify(rawDestination)} is not a key in this product's "retailers"`,
          )
        } else {
          destination = rawDestination
        }
      }

      // choice (F14)
      const rawChoice = rawProduct['choice']
      if (rawChoice !== undefined && typeof rawChoice !== 'boolean') {
        err(`${path}.choice`, 'must be a boolean')
      }
      const choice = rawChoice === true

      // deepLinks (F16)
      const rawDeepLinks = rawProduct['deepLinks']
      let deepLinks: ProductConfig['deepLinks']
      if (rawDeepLinks !== undefined) {
        if (!isRecord(rawDeepLinks)) {
          err(`${path}.deepLinks`, 'must be an object like { "mobile": { "url": "…" } }')
        } else {
          for (const deepLinkKey of Object.keys(rawDeepLinks)) {
            if (deepLinkKey !== 'mobile') {
              warn(`${path}.deepLinks.${deepLinkKey}`, 'unknown deep-link key (only "mobile" is supported)')
            }
          }
          const rawMobile = rawDeepLinks['mobile']
          if (rawMobile !== undefined) {
            const mobilePath = `${path}.deepLinks.mobile`
            if (!isRecord(rawMobile)) {
              err(mobilePath, 'must be an object with a "url" and/or "urlByCountry"')
            } else {
              const url = parseDestinationUrl(rawMobile['url'], `${mobilePath}.url`, 'any', err, warn)
              const urlByCountry = parseUrlByCountry(
                rawMobile['urlByCountry'],
                `${mobilePath}.urlByCountry`,
                'any',
                err,
                warn,
              )
              if (url === undefined && Object.keys(urlByCountry).length === 0) {
                err(mobilePath, 'needs a "url" and/or at least one "urlByCountry" entry')
              } else {
                deepLinks = {
                  mobile: {
                    ...(url !== undefined ? { url } : {}),
                    ...(rawMobile['urlByCountry'] !== undefined ? { urlByCountry } : {}),
                  },
                }
              }
            }
          }
        }
      }

      // Termination invariants: /go/<key> must resolve to a destination for
      // every possible visitor country (F3's guarantee extended to F14/F15).
      const effectiveDestination = destination ?? 'amazon'
      const destinationHasCatchAll =
        effectiveDestination !== 'amazon' && retailers[effectiveDestination]?.url !== undefined
      if (rawAsin === undefined) {
        if (!destinationHasCatchAll && !choice) {
          err(
            `${path}.asin`,
            'required unless "destination" names a retailer with a catch-all "url" — resolution must terminate for every country',
          )
        }
        if (availableIn.length > 0) {
          err(`${path}.availableIn`, 'has no effect without an "asin"')
        }
        if (Object.keys(asinByMarketplace).length > 0) {
          err(`${path}.asinByMarketplace`, 'has no effect without an "asin"')
        }
      }
      if (choice) {
        const catchAllRetailers = Object.values(retailers).filter((r) => r.url !== undefined)
        if (asin === undefined && catchAllRetailers.length === 0) {
          err(
            `${path}.choice`,
            'a choice page needs an "asin" or at least one retailer with a catch-all "url" so every visitor sees at least one link',
          )
        }
        const possibleEntries = (asin !== undefined ? 1 : 0) + Object.keys(retailers).length
        if (possibleEntries < 2) {
          warn(`${path}.choice`, 'a choice page with fewer than two destinations is just a slower redirect')
        }
        if (destination !== undefined && destination !== 'amazon') {
          warn(
            `${path}.destination`,
            'ignored while "choice" is true — the choice page is rendered instead of redirecting',
          )
        }
      }

      products[key] = {
        ...(asin !== undefined ? { asin } : {}),
        asinByMarketplace,
        availableIn,
        ...(Object.keys(variants).length > 0 ? { variants } : {}),
        ...(Object.keys(retailers).length > 0 ? { retailers } : {}),
        ...(destination !== undefined ? { destination } : {}),
        ...(choice ? { choice } : {}),
        ...(deepLinks !== undefined ? { deepLinks } : {}),
      }
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
