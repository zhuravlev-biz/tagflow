import { describe, expect, it } from 'vitest'
import { goAmazonUrl, goUrl } from '../src/index.js'

describe('goUrl', () => {
  it('defaults to a relative /go path', () => {
    expect(goUrl('flagship-product')).toBe('/go/flagship-product')
  })

  it('prepends a base origin, trimming trailing slashes', () => {
    expect(goUrl('widget', { base: 'https://example.com' })).toBe('https://example.com/go/widget')
    expect(goUrl('widget', { base: 'https://example.com/' })).toBe('https://example.com/go/widget')
  })

  it('honours a custom prefix with or without slashes', () => {
    expect(goUrl('widget', { prefix: '/out' })).toBe('/out/widget')
    expect(goUrl('widget', { prefix: 'out' })).toBe('/out/widget')
    expect(goUrl('widget', { prefix: '/out/' })).toBe('/out/widget')
  })

  it('percent-encodes the product key', () => {
    expect(goUrl('a b')).toBe('/go/a%20b')
  })
})

describe('goAmazonUrl', () => {
  it('builds the raw-ASIN route', () => {
    expect(goAmazonUrl('B0XXXXXXXX')).toBe('/go/amazon/B0XXXXXXXX')
    expect(goAmazonUrl('B0XXXXXXXX', { base: 'https://example.com', prefix: '/out' })).toBe(
      'https://example.com/out/amazon/B0XXXXXXXX',
    )
  })
})
