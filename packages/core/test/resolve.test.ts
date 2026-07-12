import { describe, expect, it } from 'vitest'
import {
  ISO_3166_ALPHA2,
  parseConfig,
  resolve,
  type Config,
  type Decision,
} from '../src/index.js'

function mustParse(input: unknown): Config {
  const result = parseConfig(input)
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2))
  return result.config
}

const CONFIG = mustParse({
  defaultMarketplace: 'es',
  tags: { es: 'tag-es-21', de: 'tag-de-21', com: 'tag-us-20' },
  // fr has NO tag; it maps from FR in the built-in map.
  countryOverrides: { CH: 'com' },
  marketplaceFallbacks: { fr: 'de', 'co.uk': 'de' },
  unknownAsin: 'default',
  products: {
    widget: {
      asin: 'B000000001',
      asinByMarketplace: { de: 'B0000000DE' },
      availableIn: ['es', 'de', 'com'],
    },
    'de-only': { asin: 'B000000002', availableIn: ['de'] },
    'nowhere-else': { asin: 'B000000003', availableIn: [] },
  },
})

function redirect(decision: Decision) {
  expect(decision.type).toBe('redirect')
  if (decision.type !== 'redirect') throw new Error('unreachable')
  return decision
}

describe('resolve — curated mode', () => {
  it('direct: geo marketplace passes all gates', () => {
    const d = redirect(resolve({ country: 'DE', path: '/widget' }, CONFIG))
    expect(d.url).toBe('https://www.amazon.de/dp/B0000000DE?tag=tag-de-21')
    expect(d.marketplace).toBe('de')
    expect(d.resolutionReason).toBe('direct')
    expect(d.productKey).toBe('widget')
  })

  it('uses the base asin where no per-marketplace override exists', () => {
    const d = redirect(resolve({ country: 'ES', path: '/widget' }, CONFIG))
    expect(d.url).toBe('https://www.amazon.es/dp/B000000001?tag=tag-es-21')
  })

  it('applies config countryOverrides over the built-in map', () => {
    // Built-in map says CH → de; the config overrides CH → com.
    const d = redirect(resolve({ country: 'CH', path: '/widget' }, CONFIG))
    expect(d.marketplace).toBe('com')
    expect(d.resolutionReason).toBe('direct')
  })

  it('uses the built-in curated map (PT → es)', () => {
    const d = redirect(resolve({ country: 'PT', path: '/widget' }, CONFIG))
    expect(d.marketplace).toBe('es')
    expect(d.resolutionReason).toBe('direct')
  })

  it('unknown-country: missing, XX, T1 and unmapped countries hit the default', () => {
    for (const country of [undefined, 'XX', 'T1', 'AQ']) {
      const d = redirect(resolve({ country, path: '/widget' }, CONFIG))
      expect(d.marketplace).toBe('es')
      expect(d.resolutionReason).toBe('unknown-country')
    }
  })

  it('fallback-no-tag: candidate without a tag walks to its configured fallback', () => {
    // FR → fr (no tag) → fallback de (tagged, available).
    const d = redirect(resolve({ country: 'FR', path: '/widget' }, CONFIG))
    expect(d.marketplace).toBe('de')
    expect(d.resolutionReason).toBe('fallback-no-tag')
    expect(d.url).toContain('tag=tag-de-21')
  })

  it('fallback-unavailable: tagged candidate without the listing falls back', () => {
    // US → com (tagged) but de-only is not available there → default es.
    const d = redirect(resolve({ country: 'US', path: '/de-only' }, CONFIG))
    expect(d.marketplace).toBe('es')
    expect(d.resolutionReason).toBe('fallback-unavailable')
  })

  it('the default marketplace never gates on availability', () => {
    // nowhere-else has an empty availableIn; Spanish visitors still land on es.
    const d = redirect(resolve({ country: 'ES', path: '/nowhere-else' }, CONFIG))
    expect(d.marketplace).toBe('es')
    expect(d.resolutionReason).toBe('direct')
  })

  it('walks candidate → fallback → default when both gates fail', () => {
    // GB → co.uk (no tag) → fallback de (tagged but unavailable) → default es.
    const d = redirect(resolve({ country: 'GB', path: '/nowhere-else' }, CONFIG))
    expect(d.marketplace).toBe('es')
    expect(d.resolutionReason).toBe('fallback-no-tag')
  })

  it('unknown product key → not-found', () => {
    expect(resolve({ country: 'DE', path: '/no-such-product' }, CONFIG).type).toBe('not-found')
  })

  it('malformed paths → not-found', () => {
    for (const path of ['/', '', '/a/b/c', '/widget/extra', '/%E0%A4%A']) {
      expect(resolve({ country: 'DE', path }, CONFIG).type).toBe('not-found')
    }
  })

  it('decodes percent-encoded product keys', () => {
    const d = redirect(resolve({ country: 'DE', path: '/de%2Donly' }, CONFIG))
    expect(d.productKey).toBe('de-only')
  })
})

describe('resolve — raw ASIN mode', () => {
  it('policy "default": always the default marketplace, reason raw-asin', () => {
    const d = redirect(resolve({ country: 'DE', path: '/amazon/B00TESTASN' }, CONFIG))
    expect(d.marketplace).toBe('es')
    expect(d.resolutionReason).toBe('raw-asin')
    expect(d.url).toBe('https://www.amazon.es/dp/B00TESTASN?tag=tag-es-21')
    expect(d.productKey).toBe('B00TESTASN')
  })

  it('policy "geo": geo marketplace when tagged, tag-gated fallback otherwise', () => {
    const geoConfig = mustParse({
      defaultMarketplace: 'es',
      tags: { es: 'tag-es-21', de: 'tag-de-21' },
      marketplaceFallbacks: { fr: 'de' },
      unknownAsin: 'geo',
      products: {},
    })
    const direct = redirect(resolve({ country: 'DE', path: '/amazon/B00TESTASN' }, geoConfig))
    expect(direct.marketplace).toBe('de')
    expect(direct.resolutionReason).toBe('raw-asin')
    // fr has no tag → configured fallback de wins over default.
    const viaFallback = redirect(resolve({ country: 'FR', path: '/amazon/B00TESTASN' }, geoConfig))
    expect(viaFallback.marketplace).toBe('de')
    // untagged candidate with no configured fallback → default.
    const viaDefault = redirect(resolve({ country: 'US', path: '/amazon/B00TESTASN' }, geoConfig))
    expect(viaDefault.marketplace).toBe('es')
    // candidate that already is the default marketplace.
    const atDefault = redirect(resolve({ country: 'ES', path: '/amazon/B00TESTASN' }, geoConfig))
    expect(atDefault.marketplace).toBe('es')
  })

  it('normalizes lowercase ASINs and rejects malformed ones', () => {
    const d = redirect(resolve({ country: 'DE', path: '/amazon/b00testasn' }, CONFIG))
    expect(d.url).toContain('/dp/B00TESTASN')
    for (const path of ['/amazon/short', '/amazon/way-too-long-asin', '/amazon/', '/amazon']) {
      expect(resolve({ country: 'DE', path }, CONFIG).type).toBe('not-found')
    }
  })
})

describe('resolve — properties', () => {
  it('single-marketplace degenerate mode: every click resolves to it (F10)', () => {
    const single = mustParse({
      defaultMarketplace: 'es',
      tags: { es: 'only-21' },
      products: { widget: { asin: 'B000000001', availableIn: ['es'] } },
    })
    for (const country of [...ISO_3166_ALPHA2, undefined, 'XX']) {
      const d = redirect(resolve({ country, path: '/widget' }, single))
      expect(d.url).toBe('https://www.amazon.es/dp/B000000001?tag=only-21')
    }
  })

  it('is total and always emits a tagged Amazon URL for known products', () => {
    const countries = [...ISO_3166_ALPHA2, undefined, '', 'XX', 'T1', 'zz', '💥', 'A', 'ABC']
    for (const country of countries) {
      for (const path of ['/widget', '/de-only', '/nowhere-else']) {
        const d = redirect(resolve({ country, path }, CONFIG))
        expect(d.url).toMatch(/^https:\/\/www\.amazon\.[a-z.]+\/dp\/[A-Z0-9]{10}\?tag=.+$/)
        expect(d.url).toContain(`?tag=${CONFIG.tags[d.marketplace] ?? ''}`)
      }
    }
  })

  it('respects availableIn exactly: never lands on an unlisted non-default marketplace', () => {
    for (const country of ISO_3166_ALPHA2) {
      const d = redirect(resolve({ country, path: '/de-only' }, CONFIG))
      expect(
        d.marketplace === 'es' || d.marketplace === 'de',
        `${country} → ${d.marketplace}`,
      ).toBe(true)
    }
  })

  it('is pure: same input → same output', () => {
    const ctx = { country: 'FR', path: '/widget' }
    expect(resolve(ctx, CONFIG)).toEqual(resolve(ctx, CONFIG))
  })

  it('URL-encodes ASINs and tags', () => {
    const cfg: Config = {
      ...CONFIG,
      tags: { ...CONFIG.tags, es: 'weird tag&es' },
    }
    const d = redirect(resolve({ country: 'ES', path: '/nowhere-else' }, cfg))
    expect(d.url).toContain('tag=weird%20tag%26es')
  })

  it('degrades to the default marketplace even for invalid hand-built configs', () => {
    // Bypasses parseConfig on purpose: resolution must be total even when
    // the default marketplace has no tag (which load validation forbids).
    const broken: Config = {
      defaultMarketplace: 'es',
      tags: {},
      countryOverrides: {},
      marketplaceFallbacks: {},
      unknownAsin: 'default',
      // availableIn deliberately omitted — resolve() must treat it as empty.
      products: { widget: { asin: 'B000000001' } },
    }
    const noTag = redirect(resolve({ country: 'ES', path: '/widget' }, broken))
    expect(noTag.marketplace).toBe('es')
    expect(noTag.resolutionReason).toBe('fallback-no-tag')

    const tagged: Config = {
      ...broken,
      tags: { de: 'tag-de-21' },
      countryOverrides: { DE: 'de' },
    }
    // de is tagged but unavailable; default es is untagged → chain exhausts
    // with 'unavailable' recorded first.
    const unavailable = redirect(resolve({ country: 'DE', path: '/widget' }, tagged))
    expect(unavailable.marketplace).toBe('es')
    expect(unavailable.resolutionReason).toBe('fallback-unavailable')
  })

  it('raw-ASIN geo mode is total even for invalid hand-built configs', () => {
    // No tags at all + a self-referential fallback (both impossible after
    // parseConfig): the chain must still terminate on the default with an
    // empty tag rather than throw.
    const broken: Config = {
      defaultMarketplace: 'es',
      tags: {},
      countryOverrides: {},
      marketplaceFallbacks: { fr: 'fr' },
      unknownAsin: 'geo',
      products: {},
    }
    const d = redirect(resolve({ country: 'FR', path: '/amazon/B00TESTASN' }, broken))
    expect(d.marketplace).toBe('es')
    expect(d.url).toBe('https://www.amazon.es/dp/B00TESTASN?tag=')
  })
})
