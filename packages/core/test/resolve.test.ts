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

describe('resolve — variants (F13)', () => {
  const VARIANT_CONFIG = mustParse({
    defaultMarketplace: 'es',
    tags: { es: 'tag-es-21', de: 'tag-de-21' },
    products: {
      widget: {
        asin: 'B000000001',
        variants: { a: { weight: 1 }, b: { weight: 1, asin: 'B0BBBBBBBB' } },
      },
    },
  })

  it('random 0 selects the first variant', () => {
    const d = redirect(resolve({ country: 'ES', path: '/widget', random: 0 }, VARIANT_CONFIG))
    expect(d.variant).toBe('a')
    expect(d.url).toContain('/dp/B000000001')
  })

  it('random 0.75 selects the second variant', () => {
    const d = redirect(resolve({ country: 'ES', path: '/widget', random: 0.75 }, VARIANT_CONFIG))
    expect(d.variant).toBe('b')
    expect(d.url).toContain('/dp/B0BBBBBBBB')
  })

  it('boundary: random exactly 0.5 selects "b"', () => {
    const d = redirect(resolve({ country: 'ES', path: '/widget', random: 0.5 }, VARIANT_CONFIG))
    expect(d.variant).toBe('b')
  })

  it('just below the boundary (0.4999999) selects "a"', () => {
    const d = redirect(resolve({ country: 'ES', path: '/widget', random: 0.4999999 }, VARIANT_CONFIG))
    expect(d.variant).toBe('a')
  })

  it('random undefined selects the first variant deterministically', () => {
    const d = redirect(resolve({ country: 'ES', path: '/widget' }, VARIANT_CONFIG))
    expect(d.variant).toBe('a')
  })

  it('out-of-range random (1, 1.5, -0.1) is treated as 0', () => {
    for (const random of [1, 1.5, -0.1]) {
      const d = redirect(resolve({ country: 'ES', path: '/widget', random }, VARIANT_CONFIG))
      expect(d.variant, `random=${random}`).toBe('a')
    }
  })

  it('weights need not sum to 1: a 3/1 partition boundary sits at 0.75', () => {
    const cfg = mustParse({
      defaultMarketplace: 'es',
      tags: { es: 'tag-es-21' },
      products: {
        widget: {
          asin: 'B000000001',
          variants: { a: { weight: 3 }, b: { weight: 1, asin: 'B0BBBBBBBB' } },
        },
      },
    })
    expect(redirect(resolve({ country: 'ES', path: '/widget', random: 0.7 }, cfg)).variant).toBe('a')
    expect(redirect(resolve({ country: 'ES', path: '/widget', random: 0.75 }, cfg)).variant).toBe('b')
    expect(redirect(resolve({ country: 'ES', path: '/widget', random: 0.8 }, cfg)).variant).toBe('b')
  })

  it('a variant with no configured variants leaves decision.variant unset', () => {
    const d = redirect(resolve({ country: 'ES', path: '/widget' }, CONFIG))
    expect(d.variant).toBeUndefined()
  })

  it("a variant's asinByMarketplace replaces the base map wholesale, not merges", () => {
    const cfg = mustParse({
      defaultMarketplace: 'es',
      tags: { es: 'tag-es-21', de: 'tag-de-21' },
      products: {
        widget: {
          asin: 'B000000001',
          asinByMarketplace: { de: 'B0BASEOVDE' },
          variants: {
            a: { weight: 1 },
            b: { weight: 1, asinByMarketplace: { com: 'B0COCOCOCO' } },
          },
        },
      },
    })
    // Weights are 1/1 (total 2); 0.75 is safely past the 0.5 boundary → "b".
    const d = redirect(resolve({ country: 'DE', path: '/widget', random: 0.75 }, cfg))
    expect(d.variant).toBe('b')
    // "b"'s asinByMarketplace has no "de" entry, so resolution falls back to
    // "b"'s own base asin (the product's, since "b" defines none) — NOT the
    // base product's de override, because the variant map wholesale-replaces
    // rather than merges.
    expect(d.url).toContain('/dp/B000000001')
    expect(d.url).not.toContain('B0BASEOVDE')
  })

  it('variant selection does not affect availability gating or marketplace choice', () => {
    const cfg = mustParse({
      defaultMarketplace: 'es',
      tags: { es: 'tag-es-21', de: 'tag-de-21' },
      products: {
        widget: {
          asin: 'B000000001',
          availableIn: ['de'],
          variants: { a: { weight: 1 }, b: { weight: 1, asin: 'B0BBBBBBBB' } },
        },
      },
    })
    const withA = redirect(resolve({ country: 'DE', path: '/widget', random: 0 }, cfg))
    const withB = redirect(resolve({ country: 'DE', path: '/widget', random: 0.75 }, cfg))
    expect(withA.marketplace).toBe('de')
    expect(withB.marketplace).toBe('de')
    expect(withA.resolutionReason).toBe('direct')
    expect(withB.resolutionReason).toBe('direct')
  })

  it('raw-ASIN mode is unaffected by random', () => {
    const withRandom = redirect(
      resolve({ country: 'DE', path: '/amazon/B00TESTASN', random: 0.9 }, VARIANT_CONFIG),
    )
    const without = redirect(resolve({ country: 'DE', path: '/amazon/B00TESTASN' }, VARIANT_CONFIG))
    expect(withRandom).toEqual(without)
  })

  it('purity: same ctx (including random) → deeply equal decisions', () => {
    const ctx = { country: 'DE', path: '/widget', random: 0.42 }
    expect(resolve(ctx, VARIANT_CONFIG)).toEqual(resolve(ctx, VARIANT_CONFIG))
  })

  it('defensive: an empty variants object (hand-built config) leaves decision.variant unset', () => {
    // parseConfig never emits an empty variants object (it strips it), so
    // this exercises selectVariant's own empty-map guard directly.
    const broken: Config = {
      ...VARIANT_CONFIG,
      products: { widget: { asin: 'B000000001', variants: {} } },
    }
    const d = redirect(resolve({ country: 'ES', path: '/widget', random: 0.5 }, broken))
    expect(d.variant).toBeUndefined()
    expect(d.url).toContain('/dp/B000000001')
  })

  it('defensive: all-zero weights (hand-built config) fall back to the last variant', () => {
    // parseConfig rejects weight <= 0, so this exercises selectVariant's
    // post-loop fallback (target never becomes < any zero cumulative sum)
    // directly via a hand-built config.
    const broken: Config = {
      ...VARIANT_CONFIG,
      products: {
        widget: {
          asin: 'B000000001',
          variants: { a: { weight: 0 }, b: { weight: 0, asin: 'B0BBBBBBBB' } },
        },
      },
    }
    for (const random of [0, 0.5, 0.9999]) {
      const d = redirect(resolve({ country: 'ES', path: '/widget', random }, broken))
      expect(d.variant, `random=${random}`).toBe('b')
      expect(d.url).toContain('/dp/B0BBBBBBBB')
    }
  })
})

describe('resolve — retailers (F15)', () => {
  const RETAILER_CONFIG = mustParse({
    defaultMarketplace: 'es',
    tags: { es: 'tag-es-21' },
    products: {
      store: {
        asin: 'B000000001',
        destination: 'shop',
        retailers: {
          shop: {
            label: 'Cool Shop',
            url: 'https://shop.example.com/catchall',
            urlByCountry: { DE: 'https://shop.example.com/de' },
          },
        },
      },
      urlonly: {
        asin: 'B000000002',
        destination: 'shop2',
        retailers: { shop2: { label: 'Other Shop', urlByCountry: { DE: 'https://shop2.example.com/de' } } },
      },
      viaAmazon: {
        asin: 'B000000003',
        destination: 'amazon',
      },
    },
  })

  it('country match: external decision with the country-specific url', () => {
    const d = resolve({ country: 'DE', path: '/store' }, RETAILER_CONFIG)
    expect(d).toEqual({
      type: 'external',
      url: 'https://shop.example.com/de',
      destination: 'shop',
      resolutionReason: 'retailer',
      productKey: 'store',
    })
  })

  it('no country match: falls back to the catch-all url', () => {
    const d = resolve({ country: 'FR', path: '/store' }, RETAILER_CONFIG)
    expect(d).toEqual({
      type: 'external',
      url: 'https://shop.example.com/catchall',
      destination: 'shop',
      resolutionReason: 'retailer',
      productKey: 'store',
    })
  })

  it('retailer with neither a catch-all nor a country match falls back to the Amazon waterfall', () => {
    const d = redirect(resolve({ country: 'FR', path: '/urlonly' }, RETAILER_CONFIG))
    expect(d.resolutionReason).toBe('fallback-no-tag')
    expect(d.marketplace).toBe('es')
  })

  it('destination "amazon" explicit behaves like the default', () => {
    const explicit = resolve({ country: 'ES', path: '/viaAmazon' }, RETAILER_CONFIG)
    const cfgNoDestination = mustParse({
      defaultMarketplace: 'es',
      tags: { es: 'tag-es-21' },
      products: { viaAmazon: { asin: 'B000000003' } },
    })
    const implicit = resolve({ country: 'ES', path: '/viaAmazon' }, cfgNoDestination)
    expect(explicit).toEqual(implicit)
  })
})

describe('resolve — mobile deep links (F16)', () => {
  const DEEPLINK_CONFIG = mustParse({
    defaultMarketplace: 'es',
    tags: { es: 'tag-es-21' },
    products: {
      widget: {
        asin: 'B000000001',
        deepLinks: { mobile: { url: 'myapp://open/widget', urlByCountry: { DE: 'myapp://open/widget/de' } } },
      },
      choiceProd: {
        asin: 'B000000002',
        choice: true,
        deepLinks: { mobile: { url: 'myapp://open/choice' } },
      },
      urlonlyDeeplink: {
        asin: 'B000000003',
        deepLinks: { mobile: { urlByCountry: { DE: 'myapp://open/de-only' } } },
      },
      retailerDest: {
        asin: 'B000000004',
        destination: 'shop',
        retailers: { shop: { label: 'Shop', url: 'https://shop.example.com' } },
        deepLinks: { mobile: { url: 'myapp://open/retailer' } },
      },
    },
  })

  it('mobile visitor with a catch-all deep link gets an external decision, url untouched', () => {
    const d = resolve({ country: 'FR', path: '/widget', device: 'mobile' }, DEEPLINK_CONFIG)
    expect(d).toEqual({
      type: 'external',
      url: 'myapp://open/widget',
      destination: 'mobile',
      resolutionReason: 'mobile-deeplink',
      productKey: 'widget',
    })
  })

  it('mobile visitor with a country-specific deep link gets that url untouched', () => {
    const d = resolve({ country: 'DE', path: '/widget', device: 'mobile' }, DEEPLINK_CONFIG)
    expect(d.type).toBe('external')
    if (d.type !== 'external') throw new Error('unreachable')
    expect(d.url).toBe('myapp://open/widget/de')
  })

  it('mobile device on a product with no deepLinks configured: normal resolution', () => {
    // Exercises localizedUrl's dest-undefined guard directly (product.widget
    // in the module-level CONFIG has no deepLinks at all).
    const d = redirect(resolve({ country: 'DE', path: '/widget', device: 'mobile' }, CONFIG))
    expect(d.resolutionReason).toBe('direct')
    expect(d.marketplace).toBe('de')
  })

  it('a mobile deep link with no country falls back to the catch-all url', () => {
    const d = resolve({ path: '/widget', device: 'mobile' }, DEEPLINK_CONFIG)
    expect(d.type).toBe('external')
    if (d.type !== 'external') throw new Error('unreachable')
    expect(d.url).toBe('myapp://open/widget')
  })

  it('desktop, bot, or undefined device: normal resolution, deep link ignored', () => {
    const devices = ['desktop', 'bot', undefined] as const
    for (const device of devices) {
      const d = redirect(resolve({ country: 'FR', path: '/widget', device }, DEEPLINK_CONFIG))
      expect(d.resolutionReason).not.toBe('mobile-deeplink')
      expect(d.marketplace).toBe('es')
    }
  })

  it('urlByCountry-only deep link with a non-matching country falls through to normal resolution', () => {
    const d = redirect(resolve({ country: 'FR', path: '/urlonlyDeeplink', device: 'mobile' }, DEEPLINK_CONFIG))
    expect(d.type).toBe('redirect')
    expect(d.marketplace).toBe('es')
  })

  it('a deep link beats a choice page', () => {
    const mobile = resolve({ country: 'FR', path: '/choiceProd', device: 'mobile' }, DEEPLINK_CONFIG)
    expect(mobile.type).toBe('external')
    const desktop = resolve({ country: 'FR', path: '/choiceProd', device: 'desktop' }, DEEPLINK_CONFIG)
    expect(desktop.type).toBe('choice')
  })

  it('a deep link beats a destination retailer', () => {
    const mobile = resolve({ country: 'FR', path: '/retailerDest', device: 'mobile' }, DEEPLINK_CONFIG)
    expect(mobile.type).toBe('external')
    if (mobile.type !== 'external') throw new Error('unreachable')
    expect(mobile.resolutionReason).toBe('mobile-deeplink')
    const desktop = resolve({ country: 'FR', path: '/retailerDest', device: 'desktop' }, DEEPLINK_CONFIG)
    expect(desktop.type).toBe('external')
    if (desktop.type !== 'external') throw new Error('unreachable')
    expect(desktop.resolutionReason).toBe('retailer')
  })
})

describe('resolve — choice pages (F14)', () => {
  const CHOICE_CONFIG = mustParse({
    defaultMarketplace: 'es',
    tags: { es: 'tag-es-21', de: 'tag-de-21', com: 'tag-us-20' },
    products: {
      tripleChoice: {
        asin: 'B000000001',
        availableIn: ['de'],
        choice: true,
        retailers: {
          storeA: { label: 'Store A', url: 'https://storeA.example.com' },
          storeB: { label: 'Store B', urlByCountry: { DE: 'https://storeB.example.com/de' } },
        },
      },
      asinLessChoice: {
        choice: true,
        retailers: { storeC: { label: 'Store C', url: 'https://storeC.example.com' } },
      },
      choiceWithVariants: {
        asin: 'B000000005',
        choice: true,
        variants: { first: { weight: 1 }, second: { weight: 1, asin: 'B0SECONDVAR' } },
        retailers: { storeD: { label: 'Store D', url: 'https://storeD.example.com' } },
      },
    },
  })

  it('country match: 3 entries — amazon (tagged waterfall url), catch-all, and country-specific', () => {
    const d = resolve({ country: 'DE', path: '/tripleChoice' }, CHOICE_CONFIG)
    expect(d.type).toBe('choice')
    if (d.type !== 'choice') throw new Error('unreachable')
    expect(d.entries.map((e) => e.key)).toEqual(['amazon', 'storeA', 'storeB'])
    expect(d.entries[0]?.url).toContain('tag=')
    expect(d.entries.find((e) => e.key === 'storeB')?.url).toBe('https://storeB.example.com/de')
  })

  it('no match for the urlByCountry-only retailer: 2 entries', () => {
    const d = resolve({ country: 'FR', path: '/tripleChoice' }, CHOICE_CONFIG)
    expect(d.type).toBe('choice')
    if (d.type !== 'choice') throw new Error('unreachable')
    expect(d.entries.map((e) => e.key)).toEqual(['amazon', 'storeA'])
  })

  it('asin-less choice with one catch-all retailer: 1 entry, no amazon', () => {
    const d = resolve({ country: 'FR', path: '/asinLessChoice' }, CHOICE_CONFIG)
    expect(d.type).toBe('choice')
    if (d.type !== 'choice') throw new Error('unreachable')
    expect(d.entries).toEqual([{ key: 'storeC', label: 'Store C', url: 'https://storeC.example.com' }])
  })

  it('the amazon entry url reflects the availability waterfall (unavailable geo marketplace falls back to default)', () => {
    // US → com is tagged but tripleChoice is only available in "de"; the
    // amazon entry must show the fallback/default (es) url, not a com one.
    const d = resolve({ country: 'US', path: '/tripleChoice' }, CHOICE_CONFIG)
    expect(d.type).toBe('choice')
    if (d.type !== 'choice') throw new Error('unreachable')
    const amazon = d.entries.find((e) => e.key === 'amazon')
    expect(amazon?.url).toContain('amazon.es')
    expect(amazon?.url).toContain('tag=tag-es-21')
  })

  it('entries have exactly {key, label, url}', () => {
    const d = resolve({ country: 'DE', path: '/tripleChoice' }, CHOICE_CONFIG)
    if (d.type !== 'choice') throw new Error('unreachable')
    for (const entry of d.entries) {
      expect(Object.keys(entry).sort()).toEqual(['key', 'label', 'url'])
    }
  })

  it('a choice decision never carries a variant, even when variants are configured; amazon entry uses the base asin', () => {
    const d = resolve({ country: 'ES', path: '/choiceWithVariants' }, CHOICE_CONFIG)
    expect(d.type).toBe('choice')
    if (d.type !== 'choice') throw new Error('unreachable')
    expect(d).not.toHaveProperty('variant')
    const amazon = d.entries.find((e) => e.key === 'amazon')
    expect(amazon?.url).toContain('/dp/B000000005')
  })
})

describe('resolve — totality guard (F13–F16 additions)', () => {
  it('asin-less product with no retailers, no destination, no choice → not-found (never throws)', () => {
    // Hand-built, bypassing parseConfig — parseConfig would reject a
    // product like this at load time (no asin and no terminating
    // destination). resolve() must still degrade to not-found rather than
    // throw; this is the amazonWaterfall guard for F15/F16 configs.
    const broken: Config = {
      defaultMarketplace: 'es',
      tags: { es: 'tag-es-21' },
      countryOverrides: {},
      marketplaceFallbacks: {},
      unknownAsin: 'default',
      products: { p: {} },
    }
    expect(resolve({ country: 'ES', path: '/p' }, broken)).toEqual({ type: 'not-found' })
  })
})
