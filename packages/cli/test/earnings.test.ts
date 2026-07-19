import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runImportEarnings } from '../src/commands/import-earnings.js'
import {
  aggregateByTag,
  marketplacesForTag,
  parseAmount,
  parseEarningsReport,
} from '../src/earnings/report.js'
import type { FetchLike } from '../src/stats/ae.js'

const CONFIG = {
  defaultMarketplace: 'es',
  tags: { es: 'tag-es-21', de: 'tag-de-21' },
  countryOverrides: {},
  marketplaceFallbacks: {},
  unknownAsin: 'default',
  products: {},
}

describe('parseEarningsReport', () => {
  it('parses comma CSV with a quoted field containing a comma and an escaped quote', () => {
    const text = [
      'Date,Tracking Id,Item Name,Items Shipped,Ad Fees,Revenue,ASIN',
      '2026-01-05,tag-es-21,"Widget, ""Deluxe""",2,1.50,10.00,B000000001',
    ].join('\n')
    const { rows, skipped, issues } = parseEarningsReport(text)
    expect(issues).toEqual([])
    expect(skipped).toBe(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      tag: 'tag-es-21',
      date: '2026-01-05',
      items: 2,
      earnings: 1.5,
      revenue: 10,
      asin: 'B000000001',
    })
  })

  it('parses TSV with a preamble title line before the header, and European decimal amounts', () => {
    const text = [
      'Your Associates Earnings Report',
      '',
      'Order Date\tTracking Id\tQty\tCommission\tPrice',
      '07/19/26\ttag-de-21\t3\t5,00\t20,00',
    ].join('\n')
    const { rows, skipped, issues } = parseEarningsReport(text)
    expect(issues).toEqual([])
    expect(skipped).toBe(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.tag).toBe('tag-de-21')
    expect(rows[0]?.date).toBe('2026-07-19') // MM/DD/YY, 2-digit year
    expect(rows[0]?.items).toBe(3)
    expect(rows[0]?.earnings).toBe(5)
    expect(rows[0]?.revenue).toBe(20)
  })

  it('parses "Month DD, YYYY" dates (quoted, since the value itself contains a comma)', () => {
    const text = [
      'Tracking Id,Date Shipped,Items Shipped,Ad Fees,Revenue,ASIN',
      'tag-es-21,"July 19, 2026",1,2.50,15.00,B000000002',
    ].join('\n')
    const { rows, skipped } = parseEarningsReport(text)
    expect(skipped).toBe(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.date).toBe('2026-07-19')
  })

  it('parses MM/DD/YYYY dates', () => {
    const text = [
      'Tracking Id,Date Shipped,Items Shipped,Ad Fees,Revenue,ASIN',
      'tag-es-21,07/19/2026,1,2.50,15.00,B000000002',
    ].join('\n')
    const { rows, skipped } = parseEarningsReport(text)
    expect(skipped).toBe(0)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.date).toBe('2026-07-19')
  })

  it('returns an issue explaining what headers were seen when no tracking column exists', () => {
    const text = ['Date,Item,Qty,Fees', '2026-01-01,Widget,1,1.00'].join('\n')
    const { rows, skipped, issues } = parseEarningsReport(text)
    expect(rows).toEqual([])
    expect(skipped).toBe(0)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('tracking')
    expect(issues[0]).toContain('Date')
  })

  it('skips rows with a missing tracking id or an unparseable date, and counts them', () => {
    const text = [
      'Tracking Id,Date Shipped,Items Shipped,Ad Fees,Revenue,ASIN',
      'tag-es-21,2026-01-01,1,1.00,5.00,B000000001',
      ',2026-01-02,1,1.00,5.00,B000000002',
      'tag-es-21,not-a-date,1,1.00,5.00,B000000003',
      'tag-de-21,2026-01-03,2,2.00,10.00,B000000004',
    ].join('\n')
    const { rows, skipped, issues } = parseEarningsReport(text)
    expect(issues).toEqual([])
    expect(skipped).toBe(2)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.asin)).toEqual(['B000000001', 'B000000004'])
  })
})

describe('parseAmount', () => {
  it.each([
    ['$1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['12,34', 12.34],
    ['EUR 5.00', 5],
    ['', 0],
  ])('parses %s as %d', (input, expected) => {
    expect(parseAmount(input)).toBe(expected)
  })
})

describe('aggregateByTag', () => {
  it('sums per tag and tracks the date range', () => {
    const totals = aggregateByTag([
      { tag: 'tag-es-21', date: '2026-01-01', items: 1, earnings: 1, revenue: 5 },
      { tag: 'tag-es-21', date: '2026-01-05', items: 2, earnings: 3, revenue: 15 },
      { tag: 'tag-de-21', date: '2026-01-03', items: 1, earnings: 2, revenue: 10 },
    ])
    expect(totals.get('tag-es-21')).toEqual({
      orders: 2,
      items: 3,
      earnings: 4,
      revenue: 20,
      minDate: '2026-01-01',
      maxDate: '2026-01-05',
    })
    expect(totals.get('tag-de-21')).toEqual({
      orders: 1,
      items: 1,
      earnings: 2,
      revenue: 10,
      minDate: '2026-01-03',
      maxDate: '2026-01-03',
    })
  })
})

describe('marketplacesForTag', () => {
  it('inverts marketplace → tag into tag → marketplaces, supporting shared tags', () => {
    const map = marketplacesForTag({ es: 'tag-shared-21', de: 'tag-shared-21', fr: 'tag-fr-21' })
    expect(new Set(map.get('tag-shared-21'))).toEqual(new Set(['es', 'de']))
    expect(map.get('tag-fr-21')).toEqual(['fr'])
  })
})

interface Captured {
  url: string
  init: { method: string; headers: Record<string, string>; body: string }
}

function fakeFetch(rows: readonly Record<string, string | number>[]): { fetch: FetchLike; calls: Captured[] } {
  const calls: Captured[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: rows }) }
  }
  return { fetch, calls }
}

const REPORT_TEXT = [
  'Tracking Id,Date Shipped,Items Shipped,Ad Fees,Revenue,ASIN',
  'tag-es-21,2026-01-01,1,1.00,5.00,B000000001',
  'tag-de-21,2026-01-05,2,2.00,10.00,B000000002',
  'tag-unknown-99,2026-01-03,1,0.50,3.00,B000000003',
].join('\n')

describe('runImportEarnings', () => {
  let dir: string
  let reportPath: string
  let configPath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tagflow-earnings-'))
    reportPath = join(dir, 'report.csv')
    configPath = join(dir, 'affiliate.config.json')
    await writeFile(reportPath, REPORT_TEXT)
    await writeFile(configPath, JSON.stringify(CONFIG))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'acct-123')
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'token-abc')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('joins clicks by marketplace over the report\'s overall date range', async () => {
    const { fetch, calls } = fakeFetch([
      { marketplace: 'es', clicks: '10' },
      { marketplace: 'de', clicks: '5' },
    ])
    const code = await runImportEarnings([reportPath, configPath], fetch)
    expect(code).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.init.body).toContain("toDateTime('2026-01-01 00:00:00')")
    expect(calls[0]?.init.body).toContain("toDateTime('2026-01-05 23:59:59')")
    expect(calls[0]?.init.body).toContain('affiliate_clicks')
    expect(calls[0]?.init.body).toContain('FORMAT JSON')
  })

  it('uses a custom --dataset name in the query', async () => {
    const { fetch, calls } = fakeFetch([{ marketplace: 'es', clicks: '10' }])
    const code = await runImportEarnings([reportPath, configPath, '--dataset', 'custom_ds'], fetch)
    expect(code).toBe(0)
    expect(calls[0]?.init.body).toContain('custom_ds')
  })

  it('never calls fetch with --no-clicks', async () => {
    const { fetch, calls } = fakeFetch([])
    const code = await runImportEarnings([reportPath, configPath, '--no-clicks'], fetch)
    expect(code).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('returns 1 for a missing report file', async () => {
    const { fetch, calls } = fakeFetch([])
    const missing = join(dir, 'nope.csv')
    const code = await runImportEarnings([missing, configPath], fetch)
    expect(code).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('does not double-count a tag shared across marketplaces (one row, totals counted once)', async () => {
    const sharedConfigPath = join(dir, 'shared.config.json')
    await writeFile(
      sharedConfigPath,
      JSON.stringify({ ...CONFIG, tags: { es: 'shared-21', de: 'shared-21' } }),
    )
    const sharedReportPath = join(dir, 'shared.csv')
    await writeFile(
      sharedReportPath,
      [
        'Tracking Id,Date Shipped,Items Shipped,Ad Fees,Revenue',
        'shared-21,2026-01-01,1,1.00,5.00',
        'shared-21,2026-01-02,1,1.00,5.00',
      ].join('\n'),
    )
    const { fetch } = fakeFetch([])
    const code = await runImportEarnings([sharedReportPath, sharedConfigPath, '--no-clicks'], fetch)
    expect(code).toBe(0)
    const lines = vi.mocked(console.log).mock.calls.flat()
    const tagRows = lines.filter((l) => String(l).includes('shared-21'))
    expect(tagRows).toHaveLength(1)
    expect(tagRows[0]).toContain('es, de')
    const totalLine = lines.find((l) => String(l).startsWith('TOTAL'))
    expect(totalLine).toContain('2') // 2 orders, not 4
    expect(totalLine).not.toMatch(/\b4\b/)
  })

  it('fails hard on an unsafe --dataset name, matching stats', async () => {
    const { fetch, calls } = fakeFetch([])
    const code = await runImportEarnings([reportPath, configPath, '--dataset', 'bad;name'], fetch)
    expect(code).toBe(1)
    expect(calls).toHaveLength(0)
  })

  it('warns about tags absent from config.tags but still reports them (marketplace "?")', async () => {
    const { fetch } = fakeFetch([{ marketplace: 'es', clicks: '10' }])
    const code = await runImportEarnings([reportPath, configPath], fetch)
    expect(code).toBe(0)
    const errOutput = vi.mocked(console.error).mock.calls.flat().join('\n')
    expect(errOutput).toContain('tag-unknown-99')
    const logOutput = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(logOutput).toContain('?')
  })
})
