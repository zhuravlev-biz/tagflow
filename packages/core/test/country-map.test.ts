import { describe, expect, it } from 'vitest'
import {
  COUNTRY_TO_MARKETPLACE,
  ISO_3166_ALPHA2,
  isMarketplaceId,
  marketplaceForCountry,
} from '../src/index.js'

describe('ISO_3166_ALPHA2', () => {
  it('contains all 249 officially assigned codes, no duplicates', () => {
    expect(ISO_3166_ALPHA2.length).toBe(249)
    expect(new Set(ISO_3166_ALPHA2).size).toBe(249)
    for (const code of ISO_3166_ALPHA2) {
      expect(code).toMatch(/^[A-Z]{2}$/)
    }
  })
})

describe('COUNTRY_TO_MARKETPLACE', () => {
  it('only maps assigned ISO codes to known marketplaces', () => {
    const iso = new Set<string>(ISO_3166_ALPHA2)
    for (const [country, marketplace] of Object.entries(COUNTRY_TO_MARKETPLACE)) {
      expect(iso.has(country), `${country} must be an assigned ISO code`).toBe(true)
      expect(isMarketplaceId(marketplace), `${country} → ${String(marketplace)}`).toBe(true)
    }
  })

  it('maps every storefront country to its own marketplace', () => {
    const own: Record<string, string> = {
      US: 'com', GB: 'co.uk', DE: 'de', FR: 'fr', IT: 'it', ES: 'es',
      NL: 'nl', PL: 'pl', SE: 'se', BE: 'com.be', CA: 'ca', MX: 'com.mx',
      BR: 'com.br', JP: 'co.jp', IN: 'in', SG: 'sg', AU: 'com.au',
      AE: 'ae', SA: 'sa', TR: 'com.tr', EG: 'eg',
    }
    for (const [country, marketplace] of Object.entries(own)) {
      expect(COUNTRY_TO_MARKETPLACE[country], country).toBe(marketplace)
    }
  })

  it('encodes the documented real serving relationships', () => {
    expect(COUNTRY_TO_MARKETPLACE['PT']).toBe('es')
    expect(COUNTRY_TO_MARKETPLACE['AT']).toBe('de')
    expect(COUNTRY_TO_MARKETPLACE['IE']).toBe('co.uk')
    expect(COUNTRY_TO_MARKETPLACE['BE']).toBe('com.be')
    expect(COUNTRY_TO_MARKETPLACE['CH']).toBe('de')
    expect(COUNTRY_TO_MARKETPLACE['LU']).toBe('de')
    expect(COUNTRY_TO_MARKETPLACE['LI']).toBe('de')
    expect(COUNTRY_TO_MARKETPLACE['MC']).toBe('fr')
    expect(COUNTRY_TO_MARKETPLACE['AD']).toBe('fr')
    expect(COUNTRY_TO_MARKETPLACE['NZ']).toBe('com.au')
    for (const gulf of ['BH', 'KW', 'OM', 'QA']) {
      expect(COUNTRY_TO_MARKETPLACE[gulf], gulf).toBe('ae')
    }
  })

  it('is total over ISO + Cloudflare sentinels via marketplaceForCountry', () => {
    // Every assigned ISO code either has a curated mapping or falls through
    // to undefined (→ defaultMarketplace downstream); the lookup never throws.
    for (const code of [...ISO_3166_ALPHA2, 'XX', 'T1', 'ZZ', '', 'gb']) {
      const result = marketplaceForCountry(code)
      expect(result === undefined || isMarketplaceId(result)).toBe(true)
    }
    expect(marketplaceForCountry(undefined)).toBeUndefined()
    expect(marketplaceForCountry('XX')).toBeUndefined()
    expect(marketplaceForCountry('T1')).toBeUndefined()
    // Lookup is case-insensitive (defensive; Cloudflare sends uppercase).
    expect(marketplaceForCountry('gb')).toBe('co.uk')
  })
})
