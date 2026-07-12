/**
 * Amazon marketplaces are identified by their domain suffix (`de` for
 * amazon.de, `com.be` for amazon.com.be, …). The full list ships in core even
 * for storefronts most users cannot monetize — the config's `tags` decides
 * what is actually usable.
 */
export const MARKETPLACE_IDS = [
  'com',
  'co.uk',
  'de',
  'fr',
  'it',
  'es',
  'nl',
  'pl',
  'se',
  'com.be',
  'ca',
  'com.mx',
  'com.br',
  'co.jp',
  'in',
  'sg',
  'com.au',
  'ae',
  'sa',
  'com.tr',
  'eg',
] as const

export type MarketplaceId = (typeof MARKETPLACE_IDS)[number]

const MARKETPLACE_ID_SET: ReadonlySet<string> = new Set(MARKETPLACE_IDS)

export function isMarketplaceId(value: unknown): value is MarketplaceId {
  return typeof value === 'string' && MARKETPLACE_ID_SET.has(value)
}

/** Marketplace id → canonical storefront host. */
export const AMAZON_DOMAINS: Readonly<Record<MarketplaceId, string>> =
  Object.fromEntries(
    MARKETPLACE_IDS.map((id) => [id, `www.amazon.${id}`]),
  ) as Record<MarketplaceId, string>
