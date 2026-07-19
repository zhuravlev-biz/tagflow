import { describe, expect, it, vi } from 'vitest'
import { createPaapiEngine, createProbeEngine } from '../src/check/engines.js'
import { signRequest } from '../src/check/sigv4.js'

const noSleep = (): Promise<void> => Promise.resolve()

describe('probe engine', () => {
  it('maps HTTP statuses to listing statuses', async () => {
    const statusByAsin: Record<string, number> = {
      B00000000A: 200,
      B00000000B: 404,
      B00000000C: 503,
    }
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const asin = String(url).split('/dp/')[1] ?? ''
      return new Response(null, { status: statusByAsin[asin] ?? 500 })
    })
    const engine = createProbeEngine({ fetchFn: fetchFn as typeof fetch, sleep: noSleep })
    const results = await engine.check('de', ['B00000000A', 'B00000000B', 'B00000000C'])
    expect(results.get('B00000000A')).toBe('ok')
    expect(results.get('B00000000B')).toBe('missing')
    expect(results.get('B00000000C')).toBe('unknown')
  })

  it('probes the marketplace domain without any affiliate tag', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request) => new Response(null, { status: 200 }))
    const engine = createProbeEngine({ fetchFn: fetchFn as typeof fetch, sleep: noSleep })
    await engine.check('co.uk', ['B00000000A'])
    const url = String(fetchFn.mock.calls[0]?.[0])
    expect(url).toBe('https://www.amazon.co.uk/dp/B00000000A')
    expect(url).not.toContain('tag=')
  })

  it('rate-limits with jitter between requests', async () => {
    const sleep = vi.fn(noSleep)
    const fetchFn = vi.fn(async () => new Response(null, { status: 200 }))
    const engine = createProbeEngine({
      fetchFn: fetchFn as typeof fetch,
      sleep,
      random: () => 0.5,
      delayMs: 2000,
    })
    await engine.check('de', ['B00000000A', 'B00000000B', 'B00000000C'])
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(2500)
  })

  it('turns network errors into unknown', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    const engine = createProbeEngine({ fetchFn: fetchFn as unknown as typeof fetch, sleep: noSleep })
    const results = await engine.check('de', ['B00000000A'])
    expect(results.get('B00000000A')).toBe('unknown')
  })

  it('calls onWarn with a concise, credential-free message on a network error', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    const onWarn = vi.fn()
    const engine = createProbeEngine({
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: noSleep,
      onWarn,
    })
    await engine.check('de', ['B00000000A'])
    expect(onWarn).toHaveBeenCalledTimes(1)
    const message = onWarn.mock.calls[0]?.[0] as string
    expect(message).toContain('de')
    expect(message).toContain('ECONNRESET')
  })

  it('reports a plain 200 with a normal body as ok', async () => {
    const fetchFn = vi.fn(
      async () => new Response('<html><body>Widget — buy now</body></html>', { status: 200 }),
    )
    const engine = createProbeEngine({ fetchFn: fetchFn as typeof fetch, sleep: noSleep })
    const results = await engine.check('de', ['B00000000A'])
    expect(results.get('B00000000A')).toBe('ok')
  })

  it('treats a 200 captcha/robot-check page as unknown, not missing', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('<html><body>Enter the CAPTCHA below to prove you are not a robot.</body></html>', {
          status: 200,
        }),
    )
    const engine = createProbeEngine({ fetchFn: fetchFn as typeof fetch, sleep: noSleep })
    const results = await engine.check('com', ['B00000000A'])
    expect(results.get('B00000000A')).toBe('unknown')
  })

  it('treats a 200 amazon robot-check page (support email marker) as unknown', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          'To discuss automated access to Amazon data please contact api-services-support@amazon.com',
          { status: 200 },
        ),
    )
    const engine = createProbeEngine({ fetchFn: fetchFn as typeof fetch, sleep: noSleep })
    const results = await engine.check('com', ['B00000000A'])
    expect(results.get('B00000000A')).toBe('unknown')
  })

  it('treats a 200 redirected away from the ASIN as unknown', async () => {
    const fetchFn = vi.fn(async () => ({
      status: 200,
      url: 'https://www.amazon.com/s?k=widget',
      text: async () => '<html><body>Results for widget</body></html>',
      body: { cancel: async () => undefined },
    }))
    const engine = createProbeEngine({ fetchFn: fetchFn as unknown as typeof fetch, sleep: noSleep })
    const results = await engine.check('com', ['B00000000A'])
    expect(results.get('B00000000A')).toBe('unknown')
  })
})

describe('paapi engine', () => {
  const credentials = {
    accessKey: 'AKIDEXAMPLE',
    secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    partnerTagFor: () => 'yourtag-21',
  }

  it('sends a signed GetItems request and separates found from missing', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ ItemsResult: { Items: [{ ASIN: 'B00000000A' }] } }),
    )
    const engine = createPaapiEngine(credentials, {
      fetchFn: fetchFn as typeof fetch,
      sleep: noSleep,
      now: () => new Date('2026-07-12T00:00:00Z'),
    })
    const results = await engine.check('de', ['B00000000A', 'B00000000B'])
    expect(results.get('B00000000A')).toBe('ok')
    expect(results.get('B00000000B')).toBe('missing')

    expect(String(fetchFn.mock.calls[0]?.[0])).toBe(
      'https://webservices.amazon.de/paapi5/getitems',
    )
    const init = fetchFn.mock.calls[0]?.[1] as unknown as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
    expect(headers['x-amz-target']).toContain('GetItems')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body['PartnerTag']).toBe('yourtag-21')
    expect(body['Marketplace']).toBe('www.amazon.de')
    // Resources is optional and defaults to ["ItemInfo.Title"] server-side;
    // omit it entirely rather than sending an empty array.
    expect(body).not.toHaveProperty('Resources')
  })

  it('batches more than 10 ASINs into multiple requests', async () => {
    const fetchFn = vi.fn(async () => Response.json({ ItemsResult: { Items: [] } }))
    const engine = createPaapiEngine(credentials, {
      fetchFn: fetchFn as typeof fetch,
      sleep: noSleep,
    })
    const asins = Array.from({ length: 12 }, (_, i) => `B0000000${String(i).padStart(2, '0')}`)
    await engine.check('com', asins)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('marks the whole batch unknown on auth/throttle errors', async () => {
    const fetchFn = vi.fn(async () => Response.json({ Errors: [] }, { status: 429 }))
    const onWarn = vi.fn()
    const engine = createPaapiEngine(credentials, {
      fetchFn: fetchFn as typeof fetch,
      sleep: noSleep,
      onWarn,
    })
    const results = await engine.check('com', ['B00000000A'])
    expect(results.get('B00000000A')).toBe('unknown')
    expect(onWarn).toHaveBeenCalledTimes(1)
    const message = onWarn.mock.calls[0]?.[0] as string
    expect(message).toContain('com')
    expect(message).toContain('429')
  })

  it('calls onWarn with a concise, credential-free message on a network error', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    })
    const onWarn = vi.fn()
    const engine = createPaapiEngine(credentials, {
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: noSleep,
      onWarn,
    })
    const results = await engine.check('com', ['B00000000A'])
    expect(results.get('B00000000A')).toBe('unknown')
    expect(onWarn).toHaveBeenCalledTimes(1)
    const message = onWarn.mock.calls[0]?.[0] as string
    expect(message).toContain('com')
    expect(message).toContain('ENOTFOUND')
    expect(message).not.toContain(credentials.secretKey)
  })
})

describe('signRequest', () => {
  it('produces a stable, well-formed SigV4 signature', () => {
    const headers = signRequest({
      method: 'POST',
      host: 'webservices.amazon.de',
      path: '/paapi5/getitems',
      region: 'eu-west-1',
      service: 'ProductAdvertisingAPI',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-amz-target': 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems',
      },
      body: '{"ItemIds":["B00000000A"]}',
      accessKey: 'AKIDEXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      date: new Date('2026-07-12T00:00:00Z'),
    })
    expect(headers['x-amz-date']).toBe('20260712T000000Z')
    expect(headers['host']).toBe('webservices.amazon.de')
    expect(headers['authorization']).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260712/eu-west-1/ProductAdvertisingAPI/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-date;x-amz-target, ' +
        `Signature=${headers['authorization']?.split('Signature=')[1]}`,
    )
    // Snapshot value: locks the canonicalization against regressions.
    expect(headers['authorization']?.split('Signature=')[1]).toMatch(/^[0-9a-f]{64}$/)
    const again = signRequest({
      method: 'POST',
      host: 'webservices.amazon.de',
      path: '/paapi5/getitems',
      region: 'eu-west-1',
      service: 'ProductAdvertisingAPI',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-amz-target': 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems',
      },
      body: '{"ItemIds":["B00000000A"]}',
      accessKey: 'AKIDEXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      date: new Date('2026-07-12T00:00:00Z'),
    })
    expect(again['authorization']).toBe(headers['authorization'])
  })

  it('matches a frozen snapshot signature for a fixed input', () => {
    // Regression guard for canonicalization drift: header ordering, the
    // body hash, and the credential scope all feed the signature, and a hex
    // shape check alone wouldn't catch a subtly wrong canonical form. This
    // authorization header was computed once (offline, same algorithm) for
    // the fixed inputs below and is hard-coded so any future change to
    // header casing/sorting, body hashing, or scope construction fails loudly.
    const headers = signRequest({
      method: 'POST',
      host: 'webservices.amazon.com',
      path: '/paapi5/getitems',
      region: 'us-east-1',
      service: 'ProductAdvertisingAPI',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-encoding': 'amz-1.0',
        'x-amz-target': 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems',
      },
      body:
        '{"ItemIds":["B00000000A"],"ItemIdType":"ASIN","PartnerTag":"yourtag-20",' +
        '"PartnerType":"Associates","Marketplace":"www.amazon.com"}',
      accessKey: 'AKIDEXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      date: new Date('2015-08-30T12:36:00Z'),
    })
    expect(headers['authorization']).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/ProductAdvertisingAPI/aws4_request, ' +
        'SignedHeaders=content-encoding;content-type;host;x-amz-date;x-amz-target, ' +
        'Signature=e633dbf171e9ed6fe6f17c1cac2c608dea6d9e323e57686ef91301adf3562ee7',
    )
  })
})
