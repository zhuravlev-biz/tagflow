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

  it('rejects a bad unknownAsin policy', () => {
    expect(errorsOf({ ...VALID, unknownAsin: 'search' })[0]).toContain('unknownAsin')
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
