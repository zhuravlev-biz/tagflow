import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runStats } from '../src/commands/stats.js'
import type { FetchLike } from '../src/stats/ae.js'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
  vi.stubEnv('CLOUDFLARE_API_TOKEN', 'token-abc')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

interface Captured {
  url: string
  init: { method: string; headers: Record<string, string>; body: string }
}

function fakeFetch(
  bodies: readonly (readonly Record<string, string | number>[])[],
): { fetch: FetchLike; calls: Captured[] } {
  const calls: Captured[] = []
  let i = 0
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const data = bodies[i] ?? []
    i += 1
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data }),
    }
  }
  return { fetch, calls }
}

describe('stats command: env handling', () => {
  it('returns 1 without calling fetch when credentials are missing', async () => {
    vi.unstubAllEnvs()
    const { fetch, calls } = fakeFetch([[]])
    expect(await runStats([], fetch)).toBe(1)
    expect(calls).toHaveLength(0)
    const output = vi.mocked(console.error).mock.calls.flat().join('\n')
    expect(output).toContain('CLOUDFLARE_ACCOUNT_ID')
    expect(output).toContain('CLOUDFLARE_API_TOKEN')
    expect(output).toContain('Account Analytics: Read')
  })
})

describe('stats command: flag validation', () => {
  it('rejects --days 0', async () => {
    const { fetch, calls } = fakeFetch([[]])
    expect(await runStats(['--days', '0'], fetch)).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('rejects a non-numeric --days', async () => {
    const { fetch, calls } = fakeFetch([[]])
    expect(await runStats(['--days', 'abc'], fetch)).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('rejects --days above 90', async () => {
    const { fetch, calls } = fakeFetch([[]])
    expect(await runStats(['--days', '91'], fetch)).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('rejects a bad --limit', async () => {
    const { fetch, calls } = fakeFetch([[]])
    expect(await runStats(['--limit', '0'], fetch)).toBe(1)
    expect(calls).toHaveLength(0)
    expect(await runStats(['--limit', '1001'], fetch)).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('rejects an unsafe --dataset name', async () => {
    const { fetch, calls } = fakeFetch([[]])
    expect(await runStats(['--dataset', 'bad-name;drop'], fetch)).toBe(1)
    expect(calls).toHaveLength(0)
    const output = vi.mocked(console.error).mock.calls.flat().join('\n')
    expect(output).toContain('bad-name;drop')
  })
})

describe('stats command: default report', () => {
  it('sends the expected requests and prints tables on the happy path', async () => {
    const { fetch, calls } = fakeFetch([
      [{ marketplace: 'de', reason: 'direct', clicks: '42' }],
      [{ product: 'widget', clicks: 7 }],
    ])
    const code = await runStats(['--dataset', 'clicks_test', '--days', '14', '--limit', '5'], fetch)
    expect(code).toBe(0)
    expect(calls).toHaveLength(2)

    for (const call of calls) {
      expect(call.url).toContain('acct-123')
      expect(call.url).toContain('/analytics_engine/sql')
      expect(call.init.headers['authorization']).toBe('Bearer token-abc')
    }
    expect(calls[0]?.init.body).toContain('clicks_test')
    expect(calls[0]?.init.body).toContain("INTERVAL '14' DAY")
    expect(calls[0]?.init.body).toContain('FORMAT JSON')
    expect(calls[1]?.init.body).toContain('LIMIT 5')

    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('widget')
    expect(output).toContain('42')
  })

  it('prints a friendly note and returns 0 when there are no clicks', async () => {
    const { fetch } = fakeFetch([[], []])
    expect(await runStats([], fetch)).toBe(0)
    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('no clicks recorded')
  })

  it('returns 1 when the API responds with an error', async () => {
    const fetch: FetchLike = async () => ({
      ok: false,
      status: 400,
      text: async () => 'bad SQL near GROUP BY',
    })
    expect(await runStats([], fetch)).toBe(1)
    const output = vi.mocked(console.error).mock.calls.flat().join('\n')
    expect(output).toContain('400')
  })
})

describe('stats command: --leaks report', () => {
  it('queries with the fallback-reason filter and prints the leak table', async () => {
    const { fetch, calls } = fakeFetch([
      [{ product: 'widget', marketplace: 'de', reason: 'fallback-unavailable', clicks: '3' }],
    ])
    const code = await runStats(['--leaks', '--days', '30'], fetch)
    expect(code).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.init.body).toContain("IN ('fallback-no-tag', 'fallback-unavailable')")
    expect(calls[0]?.init.body).toContain("INTERVAL '30' DAY")
    expect(calls[0]?.init.body).toContain('FORMAT JSON')

    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('revenue leak')
    expect(output).toContain('widget')
  })

  it('reports no leaks detected when there are zero fallback rows', async () => {
    const { fetch } = fakeFetch([[]])
    expect(await runStats(['--leaks'], fetch)).toBe(0)
    const output = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(output).toContain('no leaks detected')
  })
})
