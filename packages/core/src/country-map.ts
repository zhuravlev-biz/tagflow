import type { MarketplaceId } from './marketplaces.js'

/**
 * All 249 officially assigned ISO 3166-1 alpha-2 codes. Used by the
 * total-coverage test and by config validation to warn about
 * `countryOverrides` keys that are not real country codes.
 */
export const ISO_3166_ALPHA2 = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT',
  'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN',
  'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ',
  'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO',
  'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ',
  'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
  'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP',
  'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY',
  'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP',
  'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
  'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO',
  'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'OM',
  'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT',
  'PW', 'PY',
  'QA',
  'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM',
  'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ',
  'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR',
  'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'UM', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
  'WF', 'WS',
  'YE', 'YT',
  'ZA', 'ZM', 'ZW',
] as const

/**
 * Curated country → nearest/serving storefront map. Entries encode real
 * Amazon serving relationships, not geographic guesses. Any country absent
 * from this map resolves to the configured `defaultMarketplace` — that is the
 * deliberate sentinel for "no meaningful storefront relationship".
 */
export const COUNTRY_TO_MARKETPLACE: Readonly<
  Partial<Record<string, MarketplaceId>>
> = {
  // Countries with their own storefront.
  US: 'com',
  GB: 'co.uk',
  DE: 'de',
  FR: 'fr',
  IT: 'it',
  ES: 'es',
  NL: 'nl',
  PL: 'pl',
  SE: 'se',
  BE: 'com.be',
  CA: 'ca',
  MX: 'com.mx',
  BR: 'com.br',
  JP: 'co.jp',
  IN: 'in',
  SG: 'sg',
  AU: 'com.au',
  AE: 'ae',
  SA: 'sa',
  TR: 'com.tr',
  EG: 'eg',

  // Amazon serves Portugal from amazon.es (there is no amazon.pt).
  PT: 'es',
  // German-speaking neighbours served by amazon.de.
  AT: 'de',
  CH: 'de',
  LU: 'de',
  LI: 'de',
  // Ireland is served by amazon.co.uk; Crown dependencies likewise.
  IE: 'co.uk',
  GG: 'co.uk',
  JE: 'co.uk',
  IM: 'co.uk',
  // French microstates and overseas territories served by amazon.fr.
  MC: 'fr',
  AD: 'fr',
  GP: 'fr',
  MQ: 'fr',
  GF: 'fr',
  RE: 'fr',
  YT: 'fr',
  PM: 'fr',
  BL: 'fr',
  MF: 'fr',
  // Italian enclaves served by amazon.it.
  SM: 'it',
  VA: 'it',
  // amazon.se ships to the Nordics.
  DK: 'se',
  FI: 'se',
  NO: 'se',
  AX: 'se',
  // New Zealand is served by amazon.com.au.
  NZ: 'com.au',
  // Gulf states without their own storefront are served by amazon.ae.
  BH: 'ae',
  KW: 'ae',
  OM: 'ae',
  QA: 'ae',
  // US territories served domestically by amazon.com.
  PR: 'com',
  GU: 'com',
  VI: 'com',
  AS: 'com',
  MP: 'com',
  UM: 'com',
}

/**
 * Cloudflare uses `XX` (unknown) and `T1` (Tor) as non-country values in
 * `request.cf.country`; both must resolve to the default marketplace.
 */
export function marketplaceForCountry(
  country: string | undefined,
): MarketplaceId | undefined {
  if (!country) return undefined
  return COUNTRY_TO_MARKETPLACE[country.toUpperCase()]
}
