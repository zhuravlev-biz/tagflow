import type { MarketplaceId } from '@tagflow/core'

/**
 * Pure parsing/aggregation for Amazon Associates earnings/orders reports
 * (F17). No I/O here — `commands/import-earnings.ts` handles reading the
 * file, loading the config, and querying Analytics Engine; this module is
 * fully unit-testable on plain strings.
 */

export interface EarningsRow {
  readonly tag: string
  /** Always normalized to YYYY-MM-DD. */
  readonly date: string
  readonly items: number
  readonly earnings: number
  readonly revenue: number
  readonly asin?: string
}

export interface ParsedReport {
  readonly rows: EarningsRow[]
  readonly skipped: number
  readonly issues: string[]
}

export interface TagTotals {
  readonly orders: number
  readonly items: number
  readonly earnings: number
  readonly revenue: number
  readonly minDate: string
  readonly maxDate: string
}

/** Case-insensitive substring the header row must contain somewhere. */
const HEADER_MARKER = 'tracking'

/**
 * Tokenize one line of CSV/TSV per RFC 4180: `"` quotes fields, `""` escapes
 * a literal quote, and a quoted field may contain the delimiter. This is a
 * single-line tokenizer — quoted fields spanning multiple physical lines are
 * not supported (Associates reports don't need it: values never embed
 * newlines).
 */
function tokenizeLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes && ch === '"' && line[i + 1] === '"') {
      cur += '"'
      i++
    } else if (inQuotes && ch === '"') {
      inQuotes = false
    } else if (inQuotes) {
      cur += ch
    } else if (ch === '"' && cur === '') {
      inQuotes = true
    } else if (ch === delimiter) {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells
}

/** First header cell (already lowercased/trimmed) containing any pattern, tried in priority order. */
function findColumn(headerCells: readonly string[], patterns: readonly string[]): number | undefined {
  for (const pattern of patterns) {
    const index = headerCells.findIndex((cell) => cell.includes(pattern))
    if (index !== -1) return index
  }
  return undefined
}

const MONTHS: Readonly<Record<string, number>> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isValidDate(y: number, m: number, d: number): boolean {
  return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d) && m >= 1 && m <= 12 && d >= 1 && d <= 31
}

/**
 * Parse a report date cell into YYYY-MM-DD. Accepts 'YYYY-MM-DD',
 * 'Month DD, YYYY' (English month names, full or abbreviated), 'MM/DD/YY'
 * and 'MM/DD/YYYY'. Returns undefined when the cell doesn't match any of
 * these (the row is then skipped by the caller).
 */
function parseReportDate(raw: string): string | undefined {
  const s = raw.trim()
  if (s === '') return undefined
  // The three shapes are mutually exclusive, so at most one parser matches.
  return parseIsoDate(s) ?? parseMonthNameDate(s) ?? parseSlashDate(s)
}

// Group access below uses `?? ''` instead of assertions: every group is
// non-optional in its pattern, so the fallback is unreachable, but this keeps
// noUncheckedIndexedAccess honest without `as` escape hatches.

/** 'YYYY-MM-DD'. */
function parseIsoDate(s: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return undefined
  const [y, mo, d] = [m[1] ?? '', m[2] ?? '', m[3] ?? '']
  return isValidDate(Number(y), Number(mo), Number(d)) ? `${y}-${mo}-${d}` : undefined
}

/** 'Month DD, YYYY' (English month names, full or abbreviated). */
function parseMonthNameDate(s: string): string | undefined {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(s)
  if (!m) return undefined
  const month = MONTHS[(m[1] ?? '').toLowerCase()]
  if (month === undefined) return undefined
  const y = Number(m[3] ?? '')
  const d = Number(m[2] ?? '')
  return isValidDate(y, month, d) ? `${y}-${pad2(month)}-${pad2(d)}` : undefined
}

/** Two-digit years pivot at 69: 00–69 → 2000s, 70–99 → 1900s. */
function expandYear(yr: string): number {
  const n = Number(yr)
  if (yr.length !== 2) return n
  return n <= 69 ? 2000 + n : 1900 + n
}

/** 'MM/DD/YY' and 'MM/DD/YYYY'. */
function parseSlashDate(s: string): string | undefined {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s)
  if (!m) return undefined
  const year = expandYear(m[3] ?? '')
  const month = Number(m[1] ?? '')
  const day = Number(m[2] ?? '')
  return isValidDate(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : undefined
}

/**
 * Parse a currency/amount cell into a number. Strips currency symbols and
 * spaces, then figures out whether the last `,`/`.` is the decimal
 * separator: US-style '1,234.56' (comma thousands, dot decimal) and
 * European '1.234,56' / '12,34' (dot thousands, comma decimal — recognized
 * when the comma is followed by exactly two digits) are both handled.
 * Anything unparseable becomes 0 rather than throwing — a single garbage
 * cell shouldn't sink the whole report.
 */
export function parseAmount(raw: string): number {
  const trimmed = raw.trim()
  if (trimmed === '') return 0
  let s = trimmed.replaceAll(/[^0-9.,-]/g, '')
  if (s === '' || s === '-') return 0

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > lastDot) {
    const fractional = s.slice(lastComma + 1)
    if (/^\d{2}$/.test(fractional)) {
      // European decimal comma: dots before it are thousands separators.
      s = `${s.slice(0, lastComma).replaceAll('.', '')}.${fractional}`
    } else {
      s = s.replaceAll(',', '')
    }
  } else {
    s = s.replaceAll(',', '')
  }

  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * Parse an Amazon Associates earnings/orders report (CSV or TSV, with or
 * without a preamble title line before the header, quoted or bare fields).
 */
export function parseEarningsReport(text: string): ParsedReport {
  const lines = text.split(/\r\n|\r|\n/)

  const header = findHeader(lines)
  if (header === undefined) {
    return { rows: [], skipped: 0, issues: [noHeaderIssue(lines)] }
  }

  const normalized = header.cells.map((c) => c.trim().toLowerCase())
  const trackingIdx = findColumn(normalized, ['tracking'])
  const dateIdx = findColumn(normalized, ['date shipped', 'shipment date', 'order date', 'date'])

  if (trackingIdx === undefined || dateIdx === undefined) {
    const missing = [
      trackingIdx === undefined ? 'tracking tag' : undefined,
      dateIdx === undefined ? 'date' : undefined,
    ].filter((s): s is string => s !== undefined)
    return {
      rows: [],
      skipped: 0,
      issues: [
        `could not find required column(s): ${missing.join(', ')}; headers seen: ${header.cells
          .map((c) => c.trim())
          .join(', ')}`,
      ],
    }
  }

  const columns: ReportColumns = {
    tracking: trackingIdx,
    date: dateIdx,
    items: findColumn(normalized, ['items shipped', 'quantity', 'qty', 'items']),
    earnings: findColumn(normalized, ['ad fees', 'advertising fee', 'fees', 'earnings', 'commission']),
    revenue: findColumn(normalized, ['revenue', 'price']),
    asin: findColumn(normalized, ['asin']),
  }

  const rows: EarningsRow[] = []
  let skipped = 0
  for (let i = header.index + 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.trim() === '') continue
    const row = parseRow(tokenizeLine(line, header.delimiter), columns)
    if (row === undefined) skipped++
    else rows.push(row)
  }

  return { rows, skipped, issues: [] }
}

interface ReportHeader {
  readonly index: number
  readonly delimiter: string
  readonly cells: readonly string[]
}

/** First non-blank line with a cell containing HEADER_MARKER; the delimiter is sniffed per line. */
function findHeader(lines: readonly string[]): ReportHeader | undefined {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line.trim() === '') continue
    const delimiter = line.includes('\t') ? '\t' : ','
    const cells = tokenizeLine(line, delimiter)
    if (cells.some((cell) => cell.trim().toLowerCase().includes(HEADER_MARKER))) {
      return { index: i, delimiter, cells }
    }
  }
  return undefined
}

function noHeaderIssue(lines: readonly string[]): string {
  const firstLine = lines.find((l) => l.trim() !== '') ?? ''
  const tentativeDelimiter = firstLine.includes('\t') ? '\t' : ','
  const seen = tokenizeLine(firstLine, tentativeDelimiter)
    .map((c) => c.trim())
    .filter((c) => c !== '')
  return `no header row found: expected a column containing "tracking" (e.g. "Tracking Id"); headers seen: ${
    seen.length > 0 ? seen.join(', ') : '(none)'
  }`
}

/** Column indexes; the optional ones are `undefined` when the report lacks them. */
interface ReportColumns {
  readonly tracking: number
  readonly date: number
  readonly items: number | undefined
  readonly earnings: number | undefined
  readonly revenue: number | undefined
  readonly asin: number | undefined
}

function amountAt(cells: readonly string[], index: number | undefined): number {
  return index === undefined ? 0 : parseAmount(cells[index] ?? '')
}

/** One data row; `undefined` when it has no tracking tag or an unparseable date. */
function parseRow(cells: readonly string[], columns: ReportColumns): EarningsRow | undefined {
  const tag = (cells[columns.tracking] ?? '').trim()
  const date = parseReportDate(cells[columns.date] ?? '')
  if (tag === '' || date === undefined) return undefined
  const asin = columns.asin === undefined ? '' : (cells[columns.asin] ?? '').trim()
  return {
    tag,
    date,
    items: amountAt(cells, columns.items),
    earnings: amountAt(cells, columns.earnings),
    revenue: amountAt(cells, columns.revenue),
    ...(asin === '' ? {} : { asin }),
  }
}

/** Aggregate parsed rows per tracking tag (F17's clicks-vs-orders view is keyed by tag). */
export function aggregateByTag(rows: readonly EarningsRow[]): Map<string, TagTotals> {
  const map = new Map<
    string,
    { orders: number; items: number; earnings: number; revenue: number; minDate: string; maxDate: string }
  >()
  for (const row of rows) {
    const existing = map.get(row.tag)
    if (existing === undefined) {
      map.set(row.tag, {
        orders: 1,
        items: row.items,
        earnings: row.earnings,
        revenue: row.revenue,
        minDate: row.date,
        maxDate: row.date,
      })
      continue
    }
    existing.orders += 1
    existing.items += row.items
    existing.earnings += row.earnings
    existing.revenue += row.revenue
    if (row.date < existing.minDate) existing.minDate = row.date
    if (row.date > existing.maxDate) existing.maxDate = row.date
  }
  return map
}

/**
 * Invert a config's `tags` map (marketplace → tag) into tag → marketplaces.
 * A tag can be reused across marketplaces (e.g. one Associates account
 * covering several storefronts), so the result is one-to-many.
 */
export function marketplacesForTag(
  tags: Readonly<Partial<Record<MarketplaceId, string>>>,
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const [marketplace, tag] of Object.entries(tags)) {
    if (tag === undefined) continue
    const list = map.get(tag) ?? []
    list.push(marketplace)
    map.set(tag, list)
  }
  return map
}
