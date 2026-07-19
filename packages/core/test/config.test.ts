import { describe, expect, it } from 'vitest'
import { parseConfig } from '../src/index.js'

const VALID = {
  defaultMarketplace: 'es',
  tags: { es: 'yourtag-21', com: 'yourtag-20', de: 'yourtag-21' },
  countryOverrides: { CH: 'de' },
  marketplaceFallbacks: { 'co.uk': 'de' },
  unknownAsin: 'default',
  products: {
    'flagship-product': {
      asin: 'B0XXXXXXXX',
      asinByMarketplace: { de: 'B0YYYYYYYY' },
      availableIn: ['es', 'de', 'com'],
    },
  },
}

function errorsOf(input: unknown): string[] {
  const result = parseConfig(input)
  if (result.ok) return []
  return result.errors.map((e) => `${e.path}: ${e.message}`)
}

describe('parseConfig', () => {
  it('accepts a valid config with no warnings', () => {
    const result = parseConfig(VALID)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    expect(result.config.defaultMarketplace).toBe('es')
    expect(result.config.unknownAsin).toBe('default')
    expect(result.config.products['flagship-product']?.availableIn).toEqual(['es', 'de', 'com'])
  })

  it('defaults unknownAsin to "default" and optional maps to empty', () => {
    const result = parseConfig({
      defaultMarketplace: 'com',
      tags: { com: 'x-20' },
      products: {},
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.unknownAsin).toBe('default')
    expect(result.config.countryOverrides).toEqual({})
    expect(result.config.marketplaceFallbacks).toEqual({})
  })

  it('rejects non-object input', () => {
    expect(parseConfig(null).ok).toBe(false)
    expect(parseConfig('str').ok).toBe(false)
    expect(parseConfig([]).ok).toBe(false)
  })

  it('rejects an unknown default marketplace', () => {
    expect(errorsOf({ ...VALID, defaultMarketplace: 'co.zz' })[0]).toContain('defaultMarketplace')
  })

  it('rejects a default marketplace without a tag', () => {
    const errors = errorsOf({ ...VALID, defaultMarketplace: 'fr' })
    expect(errors.some((e) => e.includes('no affiliate tag'))).toBe(true)
  })

  it('rejects unknown marketplaces in every reference position', () => {
    expect(errorsOf({ ...VALID, tags: { ...VALID.tags, zz: 'x-21' } })[0]).toContain('tags.zz')
    expect(errorsOf({ ...VALID, countryOverrides: { CH: 'zz' } })[0]).toContain('countryOverrides.CH')
    expect(errorsOf({ ...VALID, marketplaceFallbacks: { zz: 'de' } })[0]).toContain('marketplaceFallbacks.zz')
    expect(errorsOf({ ...VALID, marketplaceFallbacks: { de: 'zz' } })[0]).toContain('marketplaceFallbacks.de')
    expect(
      errorsOf({
        ...VALID,
        products: { p: { asin: 'B0XXXXXXXX', availableIn: ['zz'] } },
      })[0],
    ).toContain('availableIn[0]')
    expect(
      errorsOf({
        ...VALID,
        products: { p: { asin: 'B0XXXXXXXX', asinByMarketplace: { zz: 'B0YYYYYYYY' } } },
      })[0],
    ).toContain('asinByMarketplace.zz')
  })

  it('rejects self- and cyclic fallbacks', () => {
    expect(errorsOf({ ...VALID, marketplaceFallbacks: { de: 'de' } })[0]).toContain('itself')
    const errors = errorsOf({ ...VALID, marketplaceFallbacks: { de: 'fr', fr: 'de' } })
    expect(errors.some((e) => e.includes('cyclic'))).toBe(true)
  })

  it('reports a 2-cycle once, not once per member', () => {
    const errors = errorsOf({ ...VALID, marketplaceFallbacks: { de: 'fr', fr: 'de' } })
    expect(errors.filter((e) => e.includes('cyclic'))).toHaveLength(1)
  })

  it('rejects malformed country override keys, warns on unassigned ISO codes', () => {
    expect(errorsOf({ ...VALID, countryOverrides: { ch: 'de' } })[0]).toContain('uppercase')
    const result = parseConfig({ ...VALID, countryOverrides: { ZZ: 'de' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((w) => w.path === 'countryOverrides.ZZ')).toBe(true)
  })

  it('rejects the reserved product key "amazon" and URL-unsafe keys', () => {
    expect(errorsOf({ ...VALID, products: { amazon: { asin: 'B0XXXXXXXX' } } })[0]).toContain('reserved')
    expect(errorsOf({ ...VALID, products: { 'a/b': { asin: 'B0XXXXXXXX' } } })[0]).toContain('URL-safe')
    expect(errorsOf({ ...VALID, products: { 'a b': { asin: 'B0XXXXXXXX' } } })[0]).toContain('URL-safe')
  })

  it('rejects products without an asin', () => {
    expect(errorsOf({ ...VALID, products: { p: {} } })[0]).toContain('p.asin')
  })

  it('rejects a non-string or empty top-level asin', () => {
    expect(errorsOf({ ...VALID, products: { p: { asin: '' } } })[0]).toContain('must be a non-empty string')
    expect(errorsOf({ ...VALID, products: { p: { asin: 42 } } })[0]).toContain('must be a non-empty string')
  })

  it('rejects a bad unknownAsin policy', () => {
    expect(errorsOf({ ...VALID, unknownAsin: 'search' })[0]).toContain('unknownAsin')
  })

  it('rejects a non-string or empty asinByMarketplace override', () => {
    expect(
      errorsOf({
        ...VALID,
        products: { p: { asin: 'B0XXXXXXXX', asinByMarketplace: { de: '' } } },
      })[0],
    ).toContain('must be a non-empty string')
    expect(
      errorsOf({
        ...VALID,
        products: { p: { asin: 'B0XXXXXXXX', asinByMarketplace: { de: 42 } } },
      })[0],
    ).toContain('must be a non-empty string')
  })

  it('warns on an asinByMarketplace override that does not look like an ASIN', () => {
    const result = parseConfig({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', asinByMarketplace: { de: 'not-an-asin!' } } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((w) => w.path === 'products.p.asinByMarketplace.de')).toBe(true)
  })

  it('rejects a non-array availableIn', () => {
    expect(
      errorsOf({ ...VALID, products: { p: { asin: 'B0XXXXXXXX', availableIn: 'es' } } })[0],
    ).toContain('must be an array of marketplace ids')
  })

  it('warns (not errors) on atypical tag and ASIN shapes', () => {
    const result = parseConfig({
      ...VALID,
      tags: { ...VALID.tags, com: 'no trailing digits' },
      products: { p: { asin: 'not-an-asin!' } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((w) => w.path === 'tags.com')).toBe(true)
    expect(result.warnings.some((w) => w.path === 'products.p.asin')).toBe(true)
  })
})

describe('parseConfig — variants (F13)', () => {
  it('parses a valid two-variant config with weights and per-variant asin/asinByMarketplace', () => {
    const result = parseConfig({
      ...VALID,
      products: {
        p: {
          asin: 'B0XXXXXXXX',
          variants: {
            a: { weight: 1 },
            b: { weight: 2, asin: 'B0BBBBBBBB', asinByMarketplace: { de: 'B0BBBBBBDE' } },
          },
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    expect(result.config.products['p']?.variants).toEqual({
      a: { weight: 1 },
      b: { weight: 2, asin: 'B0BBBBBBBB', asinByMarketplace: { de: 'B0BBBBBBDE' } },
    })
  })

  it('rejects a zero, negative, NaN, or missing weight', () => {
    const badWeights: unknown[] = [0, -1, Number.NaN, undefined]
    for (const weight of badWeights) {
      const rawVariant: Record<string, unknown> = {}
      if (weight !== undefined) rawVariant['weight'] = weight
      const errors = errorsOf({
        ...VALID,
        products: { p: { asin: 'B0XXXXXXXX', variants: { a: rawVariant, b: { weight: 1 } } } },
      })
      expect(errors.some((e) => e.includes('variants.a.weight')), JSON.stringify({ weight, errors })).toBe(true)
    }
  })

  it('rejects a URL-unsafe variant name', () => {
    const errors = errorsOf({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', variants: { '-x': { weight: 1 } } } },
    })
    expect(errors.some((e) => e.includes('variants.-x') && e.includes('URL-safe'))).toBe(true)
  })

  it('rejects a non-string or empty variant asin', () => {
    expect(
      errorsOf({
        ...VALID,
        products: { p: { asin: 'B0XXXXXXXX', variants: { a: { weight: 1, asin: '' } } } },
      })[0],
    ).toContain('variants.a.asin')
    expect(
      errorsOf({
        ...VALID,
        products: { p: { asin: 'B0XXXXXXXX', variants: { a: { weight: 1, asin: 42 } } } },
      })[0],
    ).toContain('variants.a.asin')
  })

  it('rejects a non-record variant entry', () => {
    const errors = errorsOf({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', variants: { a: 'nope' } } },
    })
    expect(errors.some((e) => e.includes('variants.a') && e.includes('positive "weight"'))).toBe(true)
  })

  it('rejects a non-record variants block', () => {
    const errors = errorsOf({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', variants: 'nope' } },
    })
    expect(errors.some((e) => e.includes('p.variants') && e.includes('mapping variant name'))).toBe(true)
  })

  it('warns when exactly one variant is configured', () => {
    const result = parseConfig({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', variants: { a: { weight: 1 } } } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.warnings.some((w) => w.path === 'products.p.variants' && w.message.includes('one variant')),
    ).toBe(true)
  })

  it('rejects variants without a base asin', () => {
    const errors = errorsOf({
      ...VALID,
      products: {
        p: {
          destination: 'store',
          retailers: { store: { label: 'Store', url: 'https://store.example.com' } },
          variants: { a: { weight: 1 }, b: { weight: 1 } },
        },
      },
    })
    expect(errors.some((e) => e.includes('p.variants') && e.includes('require a base "asin"'))).toBe(true)
  })

  it('parses an empty variants object with no effect', () => {
    const result = parseConfig({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', variants: {} } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
    expect(result.config.products['p']?.variants).toBeUndefined()
  })
})

describe('parseConfig — retailers (F15)', () => {
  it('parses a valid retailer with label and url', () => {
    const result = parseConfig({
      ...VALID,
      products: {
        p: {
          asin: 'B0XXXXXXXX',
          retailers: { store: { label: 'Store', url: 'https://store.example.com' } },
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.products['p']?.retailers).toEqual({
      store: { label: 'Store', url: 'https://store.example.com' },
    })
  })

  it('rejects a missing or empty label', () => {
    const badRetailers: unknown[] = [
      { url: 'https://store.example.com' },
      { label: '', url: 'https://store.example.com' },
    ]
    for (const rawRetailer of badRetailers) {
      const errors = errorsOf({
        ...VALID,
        products: { p: { asin: 'B0XXXXXXXX', retailers: { store: rawRetailer } } },
      })
      expect(errors.some((e) => e.includes('retailers.store.label'))).toBe(true)
    }
  })

  it('rejects the reserved key "amazon" in any case', () => {
    for (const key of ['amazon', 'Amazon', 'AMAZON']) {
      const errors = errorsOf({
        ...VALID,
        products: {
          p: { asin: 'B0XXXXXXXX', retailers: { [key]: { label: 'x', url: 'https://x.example.com' } } },
        },
      })
      expect(errors.some((e) => e.includes('reserved'))).toBe(true)
    }
  })

  it('rejects a URL-unsafe retailer key', () => {
    const errors = errorsOf({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', retailers: { '!': { label: 'x', url: 'https://x.example.com' } } } },
    })
    expect(errors.some((e) => e.includes('URL-safe'))).toBe(true)
  })

  it('rejects a non-http(s) scheme for the catch-all url', () => {
    const errors = errorsOf({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', retailers: { store: { label: 'x', url: 'ftp://x.example.com' } } } },
    })
    expect(errors.some((e) => e.includes('retailers.store.url') && e.includes('http(s)'))).toBe(true)
  })

  it('warns but parses an http:// url', () => {
    const result = parseConfig({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', retailers: { store: { label: 'x', url: 'http://x.example.com' } } } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((w) => w.path === 'products.p.retailers.store.url')).toBe(true)
  })

  it('rejects a retailer with neither url nor urlByCountry', () => {
    const errors = errorsOf({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', retailers: { store: { label: 'x' } } } },
    })
    expect(errors.some((e) => e.includes('retailers.store') && e.includes('catch-all'))).toBe(true)

    const errors2 = errorsOf({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', retailers: { store: { label: 'x', urlByCountry: {} } } } },
    })
    expect(errors2.some((e) => e.includes('retailers.store') && e.includes('catch-all'))).toBe(true)
  })

  it('rejects a malformed urlByCountry country key', () => {
    const errors = errorsOf({
      ...VALID,
      products: {
        p: {
          asin: 'B0XXXXXXXX',
          retailers: { store: { label: 'x', urlByCountry: { de: 'https://x.example.com/de' } } },
        },
      },
    })
    expect(errors.some((e) => e.includes('retailers.store.urlByCountry.de') && e.includes('uppercase'))).toBe(true)
  })

  it('warns on an unassigned ISO country code in urlByCountry', () => {
    const result = parseConfig({
      ...VALID,
      products: {
        p: {
          asin: 'B0XXXXXXXX',
          retailers: { store: { label: 'x', urlByCountry: { ZZ: 'https://x.example.com/zz' } } },
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((w) => w.path === 'products.p.retailers.store.urlByCountry.ZZ')).toBe(true)
  })

  it('rejects an invalid urlByCountry value', () => {
    const errors = errorsOf({
      ...VALID,
      products: {
        p: {
          asin: 'B0XXXXXXXX',
          retailers: { store: { label: 'x', urlByCountry: { DE: 'ftp://x.example.com/de' } } },
        },
      },
    })
    expect(errors.some((e) => e.includes('retailers.store.urlByCountry.DE'))).toBe(true)
  })

  it('rejects a non-record retailers block and a non-record retailer entry', () => {
    expect(
      errorsOf({ ...VALID, products: { p: { asin: 'B0XXXXXXXX', retailers: 'nope' } } }).some(
        (e) => e.includes('p.retailers') && e.includes('mapping retailer key'),
      ),
    ).toBe(true)
    expect(
      errorsOf({
        ...VALID,
        products: { p: { asin: 'B0XXXXXXXX', retailers: { store: 'nope' } } },
      }).some((e) => e.includes('retailers.store') && e.includes('label')),
    ).toBe(true)
  })
})

describe('parseConfig — destination (F15)', () => {
  it('accepts "amazon"', () => {
    const result = parseConfig({ ...VALID, products: { p: { asin: 'B0XXXXXXXX', destination: 'amazon' } } })
    expect(result.ok).toBe(true)
  })

  it('accepts a key present in retailers', () => {
    const result = parseConfig({
      ...VALID,
      products: {
        p: {
          asin: 'B0XXXXXXXX',
          retailers: { store: { label: 'x', url: 'https://x.example.com' } },
          destination: 'store',
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.products['p']?.destination).toBe('store')
  })

  it('rejects an unknown destination key', () => {
    const errors = errorsOf({ ...VALID, products: { p: { asin: 'B0XXXXXXXX', destination: 'nope' } } })
    expect(errors.some((e) => e.includes('p.destination'))).toBe(true)
  })

  it('rejects a non-string destination', () => {
    const errors = errorsOf({ ...VALID, products: { p: { asin: 'B0XXXXXXXX', destination: 42 } } })
    expect(errors.some((e) => e.includes('p.destination'))).toBe(true)
  })
})

describe('parseConfig — choice (F14)', () => {
  it('parses choice=true with an asin and a retailer', () => {
    const result = parseConfig({
      ...VALID,
      products: {
        p: {
          asin: 'B0XXXXXXXX',
          choice: true,
          retailers: { store: { label: 'x', url: 'https://x.example.com' } },
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([])
  })

  it('rejects a non-boolean choice', () => {
    const errors = errorsOf({ ...VALID, products: { p: { asin: 'B0XXXXXXXX', choice: 'yes' } } })
    expect(errors.some((e) => e.includes('p.choice'))).toBe(true)
  })

  it('rejects choice=true with no asin and no catch-all retailer url', () => {
    const errors = errorsOf({
      ...VALID,
      products: {
        p: {
          choice: true,
          retailers: { store: { label: 'x', urlByCountry: { DE: 'https://x.example.com/de' } } },
        },
      },
    })
    expect(errors.some((e) => e.includes('p.choice') && e.includes('needs an "asin"'))).toBe(true)
  })

  it('warns when choice=true with only an asin (fewer than two destinations)', () => {
    const result = parseConfig({ ...VALID, products: { p: { asin: 'B0XXXXXXXX', choice: true } } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((w) => w.path === 'products.p.choice')).toBe(true)
  })

  it('parses an asin-less choice page with one catch-all retailer', () => {
    const result = parseConfig({
      ...VALID,
      products: {
        p: { choice: true, retailers: { store: { label: 'x', url: 'https://x.example.com' } } },
      },
    })
    expect(result.ok).toBe(true)
  })

  it('warns when choice=true makes a retailer destination dead config', () => {
    const result = parseConfig({
      ...VALID,
      products: {
        p: {
          asin: 'B0XXXXXXXX',
          choice: true,
          destination: 'store',
          retailers: { store: { label: 'x', url: 'https://x.example.com' } },
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(
      result.warnings.some((w) => w.path === 'products.p.destination' && w.message.includes('ignored')),
    ).toBe(true)
  })
})

describe('parseConfig — asin-less products', () => {
  it('parses with a destination retailer catch-all url', () => {
    const result = parseConfig({
      ...VALID,
      products: {
        p: {
          destination: 'store',
          retailers: { store: { label: 'x', url: 'https://x.example.com' } },
        },
      },
    })
    expect(result.ok).toBe(true)
  })

  it('rejects with a destination retailer that only has urlByCountry', () => {
    const errors = errorsOf({
      ...VALID,
      products: {
        p: {
          destination: 'store',
          retailers: { store: { label: 'x', urlByCountry: { DE: 'https://x.example.com/de' } } },
        },
      },
    })
    expect(errors.some((e) => e.includes('p.asin') && e.includes('required unless'))).toBe(true)
  })

  it('rejects with no destination at all', () => {
    const errors = errorsOf({ ...VALID, products: { p: {} } })
    expect(errors.some((e) => e.includes('p.asin'))).toBe(true)
  })

  it('rejects availableIn without an asin', () => {
    const errors = errorsOf({
      ...VALID,
      products: {
        p: {
          destination: 'store',
          retailers: { store: { label: 'x', url: 'https://x.example.com' } },
          availableIn: ['de'],
        },
      },
    })
    expect(errors.some((e) => e.includes('p.availableIn') && e.includes('no effect'))).toBe(true)
  })

  it('rejects asinByMarketplace without an asin', () => {
    const errors = errorsOf({
      ...VALID,
      products: {
        p: {
          destination: 'store',
          retailers: { store: { label: 'x', url: 'https://x.example.com' } },
          asinByMarketplace: { de: 'B0YYYYYYYY' },
        },
      },
    })
    expect(errors.some((e) => e.includes('p.asinByMarketplace') && e.includes('no effect'))).toBe(true)
  })
})

describe('parseConfig — deepLinks (F16)', () => {
  it('parses a mobile deep link with an app-scheme url', () => {
    const result = parseConfig({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', deepLinks: { mobile: { url: 'myapp://x/y' } } } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.products['p']?.deepLinks).toEqual({ mobile: { url: 'myapp://x/y' } })
  })

  it('parses a mobile deep link with only urlByCountry', () => {
    const result = parseConfig({
      ...VALID,
      products: {
        p: { asin: 'B0XXXXXXXX', deepLinks: { mobile: { urlByCountry: { DE: 'myapp://x/de' } } } },
      },
    })
    expect(result.ok).toBe(true)
  })

  it('rejects an empty mobile object', () => {
    const errors = errorsOf({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', deepLinks: { mobile: {} } } },
    })
    expect(errors.some((e) => e.includes('deepLinks.mobile') && e.includes('needs a "url"'))).toBe(true)
  })

  it('rejects a non-record deepLinks block', () => {
    const errors = errorsOf({ ...VALID, products: { p: { asin: 'B0XXXXXXXX', deepLinks: 'nope' } } })
    expect(errors.some((e) => e.includes('p.deepLinks'))).toBe(true)
  })

  it('rejects a non-record deepLinks.mobile entry', () => {
    const errors = errorsOf({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', deepLinks: { mobile: 'nope' } } },
    })
    expect(errors.some((e) => e.includes('deepLinks.mobile') && e.includes('object with a "url"'))).toBe(true)
  })

  it('warns on an unknown deep-link key', () => {
    const result = parseConfig({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', deepLinks: { ios: { url: 'myapp://x' } } } },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((w) => w.path === 'products.p.deepLinks.ios')).toBe(true)
  })

  it('rejects a mobile url without a scheme', () => {
    const errors = errorsOf({
      ...VALID,
      products: { p: { asin: 'B0XXXXXXXX', deepLinks: { mobile: { url: 'not a url' } } } },
    })
    expect(errors.some((e) => e.includes('deepLinks.mobile.url') && e.includes('missing scheme'))).toBe(true)
  })
})

describe('parseConfig — round-trip (fully-loaded product)', () => {
  it('parses asin, variants, retailers, destination, and deepLinks together', () => {
    const result = parseConfig({
      ...VALID,
      products: {
        p: {
          asin: 'B0XXXXXXXX',
          asinByMarketplace: { de: 'B0YYYYYYYY' },
          availableIn: ['es', 'de'],
          variants: { a: { weight: 1 }, b: { weight: 1, asin: 'B0BBBBBBBB' } },
          retailers: { store: { label: 'Store', url: 'https://store.example.com' } },
          destination: 'amazon',
          deepLinks: { mobile: { url: 'myapp://x/y' } },
        },
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const product = result.config.products['p']
    expect(product?.asin).toBe('B0XXXXXXXX')
    expect(product?.asinByMarketplace).toEqual({ de: 'B0YYYYYYYY' })
    expect(product?.availableIn).toEqual(['es', 'de'])
    expect(product?.variants).toEqual({ a: { weight: 1 }, b: { weight: 1, asin: 'B0BBBBBBBB' } })
    expect(product?.retailers).toEqual({ store: { label: 'Store', url: 'https://store.example.com' } })
    expect(product?.destination).toBe('amazon')
    expect(product?.deepLinks).toEqual({ mobile: { url: 'myapp://x/y' } })
  })
})
