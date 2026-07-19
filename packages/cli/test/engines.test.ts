import { describe, expect, it, vi } from 'vitest'
import { createCreatorsApiEngine, createProbeEngine } from '../src/check/engines.js'

const noSleep = (): Promise<void> => Promise.resolve()
const tokenResponse = (): Response =>
  Response.json({ access_token: 'test-token', token_type: 'bearer', expires_in: 3600 })

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

describe('creatorsapi engine', () => {
  const credentials = {
    credentialId: 'amzn1.application-oa2-client.example',
    credentialSecret: 'test-credential-secret',
    partnerTagFor: () => 'yourtag-21',
  }

  it('fetches a bearer token then sends a GetItems request, separating found from missing', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, _init?: RequestInit) =>
      String(url).includes('/auth/o2/token')
        ? tokenResponse()
        : Response.json({ itemsResult: { items: [{ asin: 'B00000000A' }] } }),
    )
    const engine = createCreatorsApiEngine(credentials, {
      fetchFn: fetchFn as typeof fetch,
      sleep: noSleep,
    })
    const results = await engine.check('de', ['B00000000A', 'B00000000B'])
    expect(results.get('B00000000A')).toBe('ok')
    expect(results.get('B00000000B')).toBe('missing')

    expect(String(fetchFn.mock.calls[0]?.[0])).toBe('https://api.amazon.com/auth/o2/token')
    expect(String(fetchFn.mock.calls[1]?.[0])).toBe('https://creatorsapi.amazon/catalog/v1/getItems')
    const init = fetchFn.mock.calls[1]?.[1] as unknown as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer test-token')
    expect(headers['x-marketplace']).toBe('www.amazon.de')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body['partnerTag']).toBe('yourtag-21')
    expect(body['marketplace']).toBe('www.amazon.de')
    // resources is optional and defaults server-side; omit it entirely
    // rather than sending an empty array.
    expect(body).not.toHaveProperty('resources')
  })

  it('reuses the cached token across marketplaces instead of refetching', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/auth/o2/token')
        ? tokenResponse()
        : Response.json({ itemsResult: { items: [] } }),
    )
    const engine = createCreatorsApiEngine(credentials, {
      fetchFn: fetchFn as typeof fetch,
      sleep: noSleep,
    })
    await engine.check('de', ['B00000000A'])
    await engine.check('fr', ['B00000000A'])
    const tokenCalls = fetchFn.mock.calls.filter((call) => String(call[0]).includes('/auth/o2/token'))
    expect(tokenCalls).toHaveLength(1)
  })

  it('refetches the token once it is close to expiry', async () => {
    let time = new Date('2026-07-12T00:00:00Z')
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/auth/o2/token')
        ? tokenResponse()
        : Response.json({ itemsResult: { items: [] } }),
    )
    const engine = createCreatorsApiEngine(credentials, {
      fetchFn: fetchFn as typeof fetch,
      sleep: noSleep,
      now: () => time,
    })
    await engine.check('de', ['B00000000A'])
    time = new Date(time.getTime() + 3600_000)
    await engine.check('fr', ['B00000000A'])
    const tokenCalls = fetchFn.mock.calls.filter((call) => String(call[0]).includes('/auth/o2/token'))
    expect(tokenCalls).toHaveLength(2)
  })

  it('batches more than 10 ASINs into multiple GetItems requests', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/auth/o2/token')
        ? tokenResponse()
        : Response.json({ itemsResult: { items: [] } }),
    )
    const engine = createCreatorsApiEngine(credentials, {
      fetchFn: fetchFn as typeof fetch,
      sleep: noSleep,
    })
    const asins = Array.from({ length: 12 }, (_, i) => `B0000000${String(i).padStart(2, '0')}`)
    await engine.check('com', asins)
    const getItemsCalls = fetchFn.mock.calls.filter((call) => String(call[0]).includes('/catalog/v1/getItems'))
    expect(getItemsCalls).toHaveLength(2)
  })

  it('marks the whole batch unknown on auth/throttle errors', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).includes('/auth/o2/token')
        ? tokenResponse()
        : Response.json({ errors: [] }, { status: 429 }),
    )
    const onWarn = vi.fn()
    const engine = createCreatorsApiEngine(credentials, {
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

  it('marks everything unknown and warns when the token request fails', async () => {
    const fetchFn = vi.fn(async () => Response.json({ error: 'invalid_client' }, { status: 401 }))
    const onWarn = vi.fn()
    const engine = createCreatorsApiEngine(credentials, {
      fetchFn: fetchFn as typeof fetch,
      sleep: noSleep,
      onWarn,
    })
    const results = await engine.check('com', ['B00000000A'])
    expect(results.get('B00000000A')).toBe('unknown')
    expect(onWarn).toHaveBeenCalledTimes(1)
    expect(onWarn.mock.calls[0]?.[0] as string).toContain('401')
  })

  it('calls onWarn with a concise, credential-free message on a network error', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/auth/o2/token')) return tokenResponse()
      throw new Error('getaddrinfo ENOTFOUND')
    })
    const onWarn = vi.fn()
    const engine = createCreatorsApiEngine(credentials, {
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
    expect(message).not.toContain(credentials.credentialSecret)
  })
})
