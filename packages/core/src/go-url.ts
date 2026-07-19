import { RESERVED_PRODUCT_KEYS } from './config.js'

export interface GoUrlOptions {
  /** Site origin to prepend, e.g. `https://example.com`. Default: none (relative URL). */
  readonly base?: string
  /** Mount prefix of the affiliate handler. Default: `/go`. */
  readonly prefix?: string
}

function joinUrl(base: string | undefined, prefix: string, segment: string): string {
  const cleanBase = base === undefined ? '' : base.replace(/\/+$/, '')
  const cleanPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`
  return `${cleanBase}${cleanPrefix.replace(/\/+$/, '')}/${segment}`
}

/**
 * Build-time helper (F8): the one way site templates should produce redirect
 * paths. Pure, zero dependencies — usable from `.astro`, JSX, MDX, Liquid,
 * anything.
 *
 * Throws a `TypeError` for `productKey` values that are guaranteed to be
 * dead links — empty, or a reserved route segment (`amazon`) — so the
 * mistake surfaces as a build failure rather than a link that 404s in
 * production. Full key-shape validation is `parseConfig`'s job, not this
 * helper's.
 */
export function goUrl(productKey: string, options: GoUrlOptions = {}): string {
  if (productKey.length === 0) {
    throw new TypeError('goUrl: productKey must not be empty')
  }
  if (RESERVED_PRODUCT_KEYS.includes(productKey.toLowerCase())) {
    throw new TypeError(`goUrl: "${productKey}" is a reserved route segment and cannot be a product key`)
  }
  return joinUrl(options.base, options.prefix ?? '/go', encodeURIComponent(productKey))
}

/**
 * Raw-ASIN variant: `/go/amazon/<asin>` for one-off links without a product
 * entry.
 *
 * Throws a `TypeError` when `asin` is empty — a guaranteed dead link. Full
 * ASIN-shape validation is `parseConfig`'s job, not this helper's.
 */
export function goAmazonUrl(asin: string, options: GoUrlOptions = {}): string {
  if (asin.length === 0) {
    throw new TypeError('goAmazonUrl: asin must not be empty')
  }
  return joinUrl(options.base, options.prefix ?? '/go', `amazon/${encodeURIComponent(asin)}`)
}
