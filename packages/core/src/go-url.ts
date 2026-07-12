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
 */
export function goUrl(productKey: string, options: GoUrlOptions = {}): string {
  return joinUrl(options.base, options.prefix ?? '/go', encodeURIComponent(productKey))
}

/** Raw-ASIN variant: `/go/amazon/<asin>` for one-off links without a product entry. */
export function goAmazonUrl(asin: string, options: GoUrlOptions = {}): string {
  return joinUrl(options.base, options.prefix ?? '/go', `amazon/${encodeURIComponent(asin)}`)
}
