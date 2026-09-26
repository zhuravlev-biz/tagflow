import { describe, expect, it } from 'vitest'
import {
  MARKETPLACE_IDS,
  parseAmazonUrl,
  parseConfig,
  withAffiliateTag,
  type Config,
} from '../src/index.js'

function mustParse(input: unknown): Config {
  const result = parseConfig(input)
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2))
  return result.config
}

describe('parseAmazonUrl', () => {
  it.each(MARKETPLACE_IDS)('recognises every AMAZON_DOMAINS marketplace: %s', (id) => {
    const parsed = parseAmazonUrl(`https://www.amazon.${id}/dp/B0XXXXXXXX`)
    expect(parsed).toEqual({ marketplace: id, asin: 'B0XXXXXXXX' })
  })

  it('recognises the bare domain and the smile./m. subdomains', () => {
    expect(parseAmazonUrl('https://amazon.de/dp/B0XXXXXXXX')?.marketplace).toBe('de')
    expect(parseAmazonUrl('https://smile.amazon.com/dp/B0XXXXXXXX')?.marketplace).toBe('com')
    expect(parseAmazonUrl('https://m.amazon.co.uk/dp/B0XXXXXXXX')?.marketplace).toBe('co.uk')
  })

  it('is case-insensitive on the host', () => {
    expect(parseAmazonUrl('https://WWW.AMAZON.COM/dp/B0XXXXXXXX')?.marketplace).toBe('com')
  })

  it('rejects lookalike hosts', () => {
    expect(parseAmazonUrl('https://amazon.es.evil.com/dp/B0XXXXXXXX')).toBeNull()
    expect(parseAmazonUrl('https://notamazon.es/dp/B0XXXXXXXX')).toBeNull()
    expect(parseAmazonUrl('https://evilamazon.com/dp/B0XXXXXXXX')).toBeNull()
    expect(parseAmazonUrl('https://amazon.com.evil.es/dp/B0XXXXXXXX')).toBeNull()
  })

  it('rejects an unrelated, well-formed URL', () => {
    expect(parseAmazonUrl('https://example.com/dp/B0XXXXXXXX')).toBeNull()
  })

  it('rejects non-http(s) schemes on an Amazon host', () => {
    expect(parseAmazonUrl('ftp://www.amazon.com/dp/B0XXXXXXXX')).toBeNull()
    expect(parseAmazonUrl('http://www.amazon.com/dp/B0XXXXXXXX')?.marketplace).toBe('com')
  })

  it('returns null for invalid URL strings without throwing', () => {
    expect(parseAmazonUrl('')).toBeNull()
    expect(parseAmazonUrl('not a url at all')).toBeNull()
    expect(parseAmazonUrl('amazon.com/dp/B0XXXXXXXX')).toBeNull()
    expect(parseAmazonUrl('://bad')).toBeNull()
  })

  it('accepts a URL object exactly like the equivalent string', () => {
    const asString = parseAmazonUrl('https://www.amazon.de/dp/B0XXXXXXXX?tag=mytag-21')
    const asUrlObject = parseAmazonUrl(new URL('https://www.amazon.de/dp/B0XXXXXXXX?tag=mytag-21'))
    expect(asUrlObject).toEqual(asString)
  })

  describe('ASIN extraction', () => {
    it('extracts from /dp/<ASIN>', () => {
      expect(parseAmazonUrl('https://www.amazon.com/dp/B0XXXXXXXX')?.asin).toBe('B0XXXXXXXX')
    })

    it('extracts from /gp/product/<ASIN>', () => {
      expect(parseAmazonUrl('https://www.amazon.com/gp/product/B0XXXXXXXX')?.asin).toBe(
        'B0XXXXXXXX',
      )
    })

    it('extracts from /<slug>/dp/<ASIN>', () => {
      expect(
        parseAmazonUrl('https://www.amazon.com/Some-Great-Widget/dp/B0XXXXXXXX')?.asin,
      ).toBe('B0XXXXXXXX')
    })

    it('extracts from the mobile /gp/aw/d/<ASIN> path', () => {
      expect(parseAmazonUrl('https://www.amazon.com/gp/aw/d/B0XXXXXXXX')?.asin).toBe('B0XXXXXXXX')
    })

    it('uppercase-normalises a lowercase ASIN', () => {
      expect(parseAmazonUrl('https://www.amazon.com/dp/b0xxxxxxxx')?.asin).toBe('B0XXXXXXXX')
    })

    it('is absent when the path carries no ASIN', () => {
      const parsed = parseAmazonUrl('https://www.amazon.com/s?k=widgets')
      expect(parsed).toEqual({ marketplace: 'com' })
      expect(parsed?.asin).toBeUndefined()
    })

    it('does not match a run longer than 10 alphanumerics', () => {
      expect(parseAmazonUrl('https://www.amazon.com/dp/B0XXXXXXXXX')?.asin).toBeUndefined()
    })
  })

  describe('tag extraction', () => {
    it('reads an existing tag query param', () => {
      expect(parseAmazonUrl('https://www.amazon.com/dp/B0XXXXXXXX?tag=mytag-21')?.tag).toBe(
        'mytag-21',
      )
    })

    it('treats an empty tag param as absent', () => {
      const parsed = parseAmazonUrl('https://www.amazon.com/dp/B0XXXXXXXX?tag=')
      expect(parsed?.tag).toBeUndefined()
    })

    it('is absent when there is no tag param at all', () => {
      expect(parseAmazonUrl('https://www.amazon.com/dp/B0XXXXXXXX')?.tag).toBeUndefined()
    })

    it('reads the tag alongside other query params', () => {
      const parsed = parseAmazonUrl(
        'https://www.amazon.com/dp/B0XXXXXXXX?ref=abc&tag=mytag-21&psc=1',
      )
      expect(parsed?.tag).toBe('mytag-21')
      expect(parsed?.asin).toBe('B0XXXXXXXX')
    })
  })
})

describe('withAffiliateTag', () => {
  const config = mustParse({
    defaultMarketplace: 'com',
    tags: { com: 'mytag-20', de: 'mytag0d-21' },
    products: {},
  })

  it('applies the configured tag when there is none yet', () => {
    const result = withAffiliateTag('https://www.amazon.com/dp/B0XXXXXXXX', config)
    expect(result).toEqual({
      url: 'https://www.amazon.com/dp/B0XXXXXXXX?tag=mytag-20',
      applied: true,
      reason: 'applied',
    })
  })

  it('accepts a URL object input and returns a string href', () => {
    const result = withAffiliateTag(new URL('https://www.amazon.de/dp/B0XXXXXXXX'), config)
    expect(result.url).toBe('https://www.amazon.de/dp/B0XXXXXXXX?tag=mytag0d-21')
    expect(result.applied).toBe(true)
    expect(result.reason).toBe('applied')
  })

  it('preserves every other query param, their order, and the hash when applying', () => {
    const result = withAffiliateTag(
      'https://www.amazon.com/dp/B0XXXXXXXX?ref=abc&psc=1#section',
      config,
    )
    expect(result.url).toBe(
      'https://www.amazon.com/dp/B0XXXXXXXX?ref=abc&psc=1&tag=mytag-20#section',
    )
    expect(result.applied).toBe(true)
  })

  it('keeps the raw encoding of other params when applying', () => {
    const result = withAffiliateTag(
      'https://www.amazon.com/s?k=padel%20racket&rh=n%3A123',
      config,
    )
    expect(result.url).toBe('https://www.amazon.com/s?k=padel%20racket&rh=n%3A123&tag=mytag-20')
  })

  it('replaces an empty tag param instead of adding a second one', () => {
    const result = withAffiliateTag('https://www.amazon.com/dp/B0XXXXXXXX?tag=&psc=1', config)
    expect(result.url).toBe('https://www.amazon.com/dp/B0XXXXXXXX?psc=1&tag=mytag-20')
    expect(result.reason).toBe('applied')
  })

  it('handles a bare trailing question mark', () => {
    const result = withAffiliateTag('https://www.amazon.com/dp/B0XXXXXXXX?', config)
    expect(result.url).toBe('https://www.amazon.com/dp/B0XXXXXXXX?tag=mytag-20')
  })

  it('leaves a URL with our own tag unchanged', () => {
    const original = 'https://www.amazon.com/dp/B0XXXXXXXX?tag=mytag-20'
    const result = withAffiliateTag(original, config)
    expect(result).toEqual({ url: original, applied: false, reason: 'has-own-tag' })
  })

  it('never overwrites a different existing tag', () => {
    const original = 'https://www.amazon.com/dp/B0XXXXXXXX?tag=someoneelses-20'
    const result = withAffiliateTag(original, config)
    expect(result).toEqual({ url: original, applied: false, reason: 'has-other-tag' })
  })

  it('leaves the URL unchanged when the marketplace has no configured tag', () => {
    const original = 'https://www.amazon.fr/dp/B0XXXXXXXX'
    const result = withAffiliateTag(original, config)
    expect(result).toEqual({ url: original, applied: false, reason: 'no-tag-for-marketplace' })
  })

  it('reports no-tag-for-marketplace even when the URL already carries some tag', () => {
    const original = 'https://www.amazon.fr/dp/B0XXXXXXXX?tag=someones-21'
    const result = withAffiliateTag(original, config)
    expect(result).toEqual({ url: original, applied: false, reason: 'no-tag-for-marketplace' })
  })

  it('leaves non-Amazon URLs unchanged, stringified as given', () => {
    const original = 'https://example.com/product/123'
    const result = withAffiliateTag(original, config)
    expect(result).toEqual({ url: original, applied: false, reason: 'not-amazon' })
  })

  it('leaves an invalid URL string unchanged, stringified as given, and never throws', () => {
    const original = 'not a url at all'
    expect(() => withAffiliateTag(original, config)).not.toThrow()
    const result = withAffiliateTag(original, config)
    expect(result).toEqual({ url: original, applied: false, reason: 'not-amazon' })
  })

  it('stringifies a non-Amazon URL object input via its href', () => {
    const urlObject = new URL('https://example.com/product/123')
    const result = withAffiliateTag(urlObject, config)
    expect(result).toEqual({ url: urlObject.href, applied: false, reason: 'not-amazon' })
  })
})
