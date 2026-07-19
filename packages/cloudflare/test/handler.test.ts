import { parseConfig } from '@tagflow/core'
import { describe, expect, it, vi } from 'vitest'
import {
  classifyUserAgent,
  createAffiliateHandler,
  createAffiliateWorker,
  type ExecutionContextLike,
} from '../src/index.js'

const CONFIG = {
  defaultMarketplace: 'es',
  tags: { es: 'tag-es-21', de: 'tag-de-21' },
  products: {
    widget: { asin: 'B000000001', availableIn: ['es', 'de'] },
  },
}

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

interface RequestInit2 {
  country?: string | undefined
  userAgent?: string | undefined
  method?: string | undefined
}

function makeRequest(url: string, init: RequestInit2 = {}): Request {
  const request = new Request(url, {
    ...(init.method === undefined ? {} : { method: init.method }),
    headers: init.userAgent === undefined ? {} : { 'user-agent': init.userAgent },
  })
  if (init.country !== undefined) {
    Object.defineProperty(request, 'cf', { value: { country: init.country } })
  }
  return request as unknown as Request
}

function makeCtx(): ExecutionContextLike & { promises: Promise<unknown>[] } {
  const promises: Promise<unknown>[] = []
  return {
    promises,
    waitUntil(promise: Promise<unknown>) {
      promises.push(promise)
    },
  }
}

describe('createAffiliateHandler', () => {
  it('throws at startup on an invalid config', () => {
    expect(() => createAffiliateHandler({ defaultMarketplace: 'nope' })).toThrow(
      /invalid affiliate config/,
    )
  })

  it('throws on raw JSON in the documented schema shape whose defaultMarketplace has no tag', () => {
    // Same top-level keys (countryOverrides/marketplaceFallbacks/unknownAsin)
    // as a parseConfig() result, but `es` — the default marketplace — has no
    // tag. Must still be rejected, not silently accepted as "already parsed".
    expect(() =>
      createAffiliateHandler({
        defaultMarketplace: 'es',
        tags: { de: 'tag-de-21' },
        countryOverrides: {},
        marketplaceFallbacks: {},
        unknownAsin: 'default',
        products: {
          widget: { asin: 'B000000001', availableIn: ['es', 'de'] },
        },
      }),
    ).toThrow(/invalid affiliate config/)
  })

  it('accepts an already-parsed Config', async () => {
    const result = parseConfig(CONFIG)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    const handler = createAffiliateHandler(result.config)
    const response = await handler(
      makeRequest('https://site.example/go/widget', { country: 'DE', userAgent: DESKTOP_UA }),
      {},
      makeCtx(),
    )
    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe(
      'https://www.amazon.de/dp/B000000001?tag=tag-de-21',
    )
  })

  it('returns null for paths outside the prefix (mounted-mode contract, F7)', async () => {
    const handler = createAffiliateHandler(CONFIG)
    for (const path of ['/', '/about', '/gopher', '/going/widget']) {
      const response = await handler(
        makeRequest(`https://site.example${path}`, { userAgent: DESKTOP_UA }),
        {},
        makeCtx(),
      )
      expect(response, path).toBeNull()
    }
  })

  it('returns null for unknown product keys so the host 404 handles them', async () => {
    const handler = createAffiliateHandler(CONFIG)
    const response = await handler(
      makeRequest('https://site.example/go/no-such-thing', { userAgent: DESKTOP_UA }),
      {},
      makeCtx(),
    )
    expect(response).toBeNull()
  })

  it('302-redirects with F9 headers', async () => {
    const handler = createAffiliateHandler(CONFIG)
    const response = await handler(
      makeRequest('https://site.example/go/widget', { country: 'DE', userAgent: DESKTOP_UA }),
      {},
      makeCtx(),
    )
    expect(response).not.toBeNull()
    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe(
      'https://www.amazon.de/dp/B000000001?tag=tag-de-21',
    )
    expect(response?.headers.get('cache-control')).toBe('no-store')
    expect(response?.headers.get('x-robots-tag')).toBe('noindex')
  })

  it('falls back to the default marketplace when request.cf is missing', async () => {
    const handler = createAffiliateHandler(CONFIG)
    const response = await handler(
      makeRequest('https://site.example/go/widget', { userAgent: DESKTOP_UA }),
      {},
      makeCtx(),
    )
    expect(response?.headers.get('location')).toBe(
      'https://www.amazon.es/dp/B000000001?tag=tag-es-21',
    )
  })

  it('honours a custom prefix', async () => {
    const handler = createAffiliateHandler(CONFIG, { prefix: '/out' })
    const viaOut = await handler(
      makeRequest('https://site.example/out/widget', { country: 'DE', userAgent: DESKTOP_UA }),
      {},
      makeCtx(),
    )
    expect(viaOut?.status).toBe(302)
    const viaGo = await handler(
      makeRequest('https://site.example/go/widget', { country: 'DE', userAgent: DESKTOP_UA }),
      {},
      makeCtx(),
    )
    expect(viaGo).toBeNull()
  })

  it('logs one data point per click via waitUntil (F11)', async () => {
    const handler = createAffiliateHandler(CONFIG)
    const writeDataPoint = vi.fn()
    const ctx = makeCtx()
    const response = await handler(
      makeRequest('https://site.example/go/widget', { country: 'FR', userAgent: DESKTOP_UA }),
      { CLICKS: { writeDataPoint } },
      ctx,
    )
    expect(response?.status).toBe(302)
    expect(ctx.promises).toHaveLength(1)
    await Promise.all(ctx.promises)
    expect(writeDataPoint).toHaveBeenCalledExactlyOnceWith({
      // FR maps to fr, which has no tag → fallback chain ends at default es.
      // Trailing '' is the A/B variant slot (F13); this product has none.
      blobs: ['FR', 'es', 'widget', 'fallback-no-tag', 'desktop', ''],
      doubles: [1],
      indexes: ['widget'],
    })
  })

  it('normalizes a lowercase cf.country to uppercase before logging and resolving', async () => {
    const handler = createAffiliateHandler(CONFIG)
    const writeDataPoint = vi.fn()
    const ctx = makeCtx()
    const response = await handler(
      makeRequest('https://site.example/go/widget', { country: 'de', userAgent: DESKTOP_UA }),
      { CLICKS: { writeDataPoint } },
      ctx,
    )
    expect(response?.headers.get('location')).toBe(
      'https://www.amazon.de/dp/B000000001?tag=tag-de-21',
    )
    await Promise.all(ctx.promises)
    expect(writeDataPoint.mock.calls[0]?.[0].blobs?.[0]).toBe('DE')
  })

  it('returns the 302 for a HEAD request but does not log a click', async () => {
    const handler = createAffiliateHandler(CONFIG)
    const writeDataPoint = vi.fn()
    const ctx = makeCtx()
    const response = await handler(
      makeRequest('https://site.example/go/widget', {
        method: 'HEAD',
        country: 'DE',
        userAgent: DESKTOP_UA,
      }),
      { CLICKS: { writeDataPoint } },
      ctx,
    )
    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe(
      'https://www.amazon.de/dp/B000000001?tag=tag-de-21',
    )
    expect(response?.headers.get('cache-control')).toBe('no-store')
    expect(response?.headers.get('x-robots-tag')).toBe('noindex')
    expect(ctx.promises).toHaveLength(0)
    expect(writeDataPoint).not.toHaveBeenCalled()
  })

  it('honours a custom analytics binding name', async () => {
    const handler = createAffiliateHandler(CONFIG, { analyticsBinding: 'AFFILIATE_CLICKS' })
    const writeDataPoint = vi.fn()
    const ctx = makeCtx()
    await handler(
      makeRequest('https://site.example/go/widget', { country: 'DE', userAgent: DESKTOP_UA }),
      { AFFILIATE_CLICKS: { writeDataPoint } },
      ctx,
    )
    await Promise.all(ctx.promises)
    expect(writeDataPoint).toHaveBeenCalledOnce()
  })

  it('skips logging silently when no analytics binding is configured', async () => {
    const handler = createAffiliateHandler(CONFIG)
    const ctx = makeCtx()
    const response = await handler(
      makeRequest('https://site.example/go/widget', { country: 'DE', userAgent: DESKTOP_UA }),
      {},
      ctx,
    )
    expect(response?.status).toBe(302)
    expect(ctx.promises).toHaveLength(0)
  })

  it('never fails the redirect on analytics errors', async () => {
    const handler = createAffiliateHandler(CONFIG)
    const ctx = makeCtx()
    const response = await handler(
      makeRequest('https://site.example/go/widget', { country: 'DE', userAgent: DESKTOP_UA }),
      {
        CLICKS: {
          writeDataPoint: () => {
            throw new Error('AE quota exceeded')
          },
        },
      },
      ctx,
    )
    expect(response?.status).toBe(302)
    await expect(Promise.all(ctx.promises)).resolves.toBeDefined()
  })

  it('redirects bots and logs uaClass=bot under the default policy', async () => {
    const handler = createAffiliateHandler(CONFIG)
    const writeDataPoint = vi.fn()
    const ctx = makeCtx()
    const response = await handler(
      makeRequest('https://site.example/go/widget', {
        country: 'DE',
        userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
      }),
      { CLICKS: { writeDataPoint } },
      ctx,
    )
    expect(response?.status).toBe(302)
    await Promise.all(ctx.promises)
    expect(writeDataPoint.mock.calls[0]?.[0].blobs?.[4]).toBe('bot')
  })

  it('bots: "ignore" redirects but skips logging', async () => {
    const handler = createAffiliateHandler(CONFIG, { bots: 'ignore' })
    const writeDataPoint = vi.fn()
    const ctx = makeCtx()
    const response = await handler(
      makeRequest('https://site.example/go/widget', {
        country: 'DE',
        userAgent: 'Googlebot/2.1 (+http://www.google.com/bot.html)',
      }),
      { CLICKS: { writeDataPoint } },
      ctx,
    )
    expect(response?.status).toBe(302)
    expect(ctx.promises).toHaveLength(0)
    expect(writeDataPoint).not.toHaveBeenCalled()
  })
})

describe('createAffiliateWorker', () => {
  it('serves the redirect and a JSON 404 for everything else', async () => {
    const worker = createAffiliateWorker(CONFIG)
    const redirect = await worker.fetch(
      makeRequest('https://site.example/go/widget', { country: 'DE', userAgent: DESKTOP_UA }),
      {},
      makeCtx(),
    )
    expect(redirect.status).toBe(302)

    const missing = await worker.fetch(
      makeRequest('https://site.example/go/nope', { userAgent: DESKTOP_UA }),
      {},
      makeCtx(),
    )
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: 'not found' })
  })
})

describe('createAffiliateHandler choice pages (F14)', () => {
  const CHOICE_CONFIG = {
    defaultMarketplace: 'es',
    tags: { es: 'tag-es-21', de: 'tag-de-21' },
    products: {
      pick: {
        asin: 'B0AAAAAAAA',
        availableIn: ['es', 'de'],
        retailers: { bol: { label: 'Bol.com', url: 'https://www.bol.com/x' } },
        choice: true,
      },
    },
  }

  it('renders a 200 HTML choice page with both links and the F14/F9 headers', async () => {
    const handler = createAffiliateHandler(CHOICE_CONFIG)
    const writeDataPoint = vi.fn()
    const ctx = makeCtx()
    const response = await handler(
      makeRequest('https://site.example/go/pick', { country: 'DE', userAgent: DESKTOP_UA }),
      { CLICKS: { writeDataPoint } },
      ctx,
    )
    expect(response?.status).toBe(200)
    expect(response?.headers.get('content-type')).toMatch(/^text\/html/)
    expect(response?.headers.get('cache-control')).toBe('no-store')
    expect(response?.headers.get('x-robots-tag')).toBe('noindex')
    const body = await response?.text()
    expect(body).toContain('https://www.amazon.de/dp/B0AAAAAAAA?tag=tag-de-21')
    expect(body).toContain('https://www.bol.com/x')

    await Promise.all(ctx.promises)
    const blobs = writeDataPoint.mock.calls[0]?.[0].blobs
    // blobs = [country, marketplace, productKey, reason, uaClass, variant]
    // (0-indexed) — a choice view has no single destination, so blobs[1] is
    // empty, and blobs[3] (the resolution reason slot) is "choice".
    expect(blobs?.[3]).toBe('choice')
    expect(blobs?.[1]).toBe('')
  })
})

describe('createAffiliateHandler A/B variants (F13)', () => {
  const VARIANT_CONFIG = {
    defaultMarketplace: 'es',
    tags: { es: 'tag-es-21', de: 'tag-de-21' },
    products: {
      multi: {
        asin: 'B0CCCCCCCC',
        availableIn: ['es', 'de'],
        variants: { a: { weight: 1 }, b: { weight: 1, asin: 'B0BBBBBBBB' } },
      },
    },
  }

  it('logs 6 blobs with the assigned variant name in the 6th', async () => {
    const handler = createAffiliateHandler(VARIANT_CONFIG)
    const writeDataPoint = vi.fn()
    const ctx = makeCtx()
    const response = await handler(
      makeRequest('https://site.example/go/multi', { country: 'DE', userAgent: DESKTOP_UA }),
      { CLICKS: { writeDataPoint } },
      ctx,
    )
    expect(response?.status).toBe(302)
    await Promise.all(ctx.promises)
    const blobs = writeDataPoint.mock.calls[0]?.[0].blobs
    expect(blobs).toHaveLength(6)
    expect(['a', 'b']).toContain(blobs?.[5])
  })
})

describe('createAffiliateHandler retailer destinations (F15)', () => {
  const RETAILER_CONFIG = {
    defaultMarketplace: 'es',
    tags: { es: 'tag-es-21', de: 'tag-de-21' },
    products: {
      destProd: {
        destination: 'bol',
        retailers: { bol: { label: 'Bol.com', url: 'https://www.bol.com/y' } },
      },
    },
  }

  it('302s straight to the retailer URL and logs ext:<key>/retailer', async () => {
    const handler = createAffiliateHandler(RETAILER_CONFIG)
    const writeDataPoint = vi.fn()
    const ctx = makeCtx()
    const response = await handler(
      makeRequest('https://site.example/go/destProd', { country: 'DE', userAgent: DESKTOP_UA }),
      { CLICKS: { writeDataPoint } },
      ctx,
    )
    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe('https://www.bol.com/y')
    await Promise.all(ctx.promises)
    const blobs = writeDataPoint.mock.calls[0]?.[0].blobs
    expect(blobs?.[1]).toBe('ext:bol')
    expect(blobs?.[3]).toBe('retailer')
  })
})

describe('createAffiliateHandler mobile deep links (F16)', () => {
  const DEEPLINK_CONFIG = {
    defaultMarketplace: 'es',
    tags: { es: 'tag-es-21', de: 'tag-de-21' },
    products: {
      deepProd: {
        asin: 'B0DDDDDDDD',
        availableIn: ['es', 'de'],
        deepLinks: { mobile: { url: 'myapp://product/1' } },
      },
    },
  }
  const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1'

  it('302s a mobile visitor to the deep link and logs ext:mobile/mobile-deeplink', async () => {
    const handler = createAffiliateHandler(DEEPLINK_CONFIG)
    const writeDataPoint = vi.fn()
    const ctx = makeCtx()
    const response = await handler(
      makeRequest('https://site.example/go/deepProd', { country: 'DE', userAgent: IPHONE_UA }),
      { CLICKS: { writeDataPoint } },
      ctx,
    )
    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe('myapp://product/1')
    await Promise.all(ctx.promises)
    const blobs = writeDataPoint.mock.calls[0]?.[0].blobs
    expect(blobs?.[1]).toBe('ext:mobile')
    expect(blobs?.[3]).toBe('mobile-deeplink')
  })

  it('302s a desktop visitor to the normal Amazon redirect instead', async () => {
    const handler = createAffiliateHandler(DEEPLINK_CONFIG)
    const response = await handler(
      makeRequest('https://site.example/go/deepProd', { country: 'DE', userAgent: DESKTOP_UA }),
      {},
      makeCtx(),
    )
    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe(
      'https://www.amazon.de/dp/B0DDDDDDDD?tag=tag-de-21',
    )
  })
})

describe('classifyUserAgent', () => {
  it('classifies desktop, mobile and bots', () => {
    expect(classifyUserAgent(DESKTOP_UA)).toBe('desktop')
    expect(
      classifyUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('mobile')
    expect(classifyUserAgent('Googlebot/2.1')).toBe('bot')
    expect(classifyUserAgent('curl/8.6.0')).toBe('bot')
    expect(classifyUserAgent('')).toBe('bot')
    expect(classifyUserAgent(null)).toBe('bot')
    expect(classifyUserAgent(undefined)).toBe('bot')
  })
})
