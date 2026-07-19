import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import type { Config } from '@tagflow/core'
import { ConfigError, DEFAULT_CONFIG_PATH, loadConfigFile, printIssues } from '../config-io.js'
import { aggregateByTag, marketplacesForTag, parseEarningsReport, type TagTotals } from '../earnings/report.js'
import {
  AeError,
  aeQuery,
  credentialsFromEnv,
  DEFAULT_DATASET,
  isSafeDatasetName,
  type FetchLike,
} from '../stats/ae.js'
import { printTable } from '../table.js'

interface ReportRow {
  /** Every marketplace the tag is configured for; `['?']` for unknown tags. */
  readonly marketplaces: readonly string[]
  readonly tag: string
  readonly totals: TagTotals
}

/**
 * `tagflow import-earnings <report.csv> [config-path] [--dataset <name>] [--no-clicks]`
 * (F17). Imports an Amazon Associates earnings/orders report, joins it
 * against Workers Analytics Engine click data by tracking tag + date, and
 * prints a clicks-vs-orders view per marketplace. Runs on the user's
 * machine only, like the rest of the CLI.
 */
export async function runImportEarnings(argv: string[], fetchImpl?: FetchLike): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dataset: { type: 'string' },
      'no-clicks': { type: 'boolean', default: false },
    },
  })

  const reportPath = positionals[0]
  if (reportPath === undefined) {
    console.error(
      '✗ usage: tagflow import-earnings <report.csv> [config-path] [--dataset <name>] [--no-clicks]',
    )
    return 1
  }
  const configPath = positionals[1] ?? DEFAULT_CONFIG_PATH

  let text: string
  try {
    text = await readFile(reportPath, 'utf8')
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    console.error(`✗ cannot read report file: ${reportPath} (${nodeError.message})`)
    return 1
  }

  let config: Config
  try {
    const loaded = await loadConfigFile(configPath)
    config = loaded.config
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`✗ ${error.message}`)
      printIssues(error.issues, 'error')
      return 1
    }
    throw error
  }

  const parsed = parseEarningsReport(text)
  if (parsed.rows.length === 0) {
    console.error(`✗ no usable rows found in ${reportPath}`)
    for (const issue of parsed.issues) console.error(`  ${issue}`)
    return 1
  }
  if (parsed.skipped > 0) {
    console.error(
      `  warning: skipped ${parsed.skipped} row(s) with an unparseable date or missing tracking id`,
    )
  }

  const totals = aggregateByTag(parsed.rows)
  const tagToMarketplaces = marketplacesForTag(config.tags)

  const unknownTags = [...totals.keys()].filter((tag) => !tagToMarketplaces.has(tag))
  if (unknownTags.length > 0) {
    console.error(
      `  warning: tag(s) not found in ${configPath}'s "tags" — shown as marketplace "?" (they still earned, so you should know where they came from): ${unknownTags.join(', ')}`,
    )
  }

  // Exactly one row per tag — a tag shared across marketplaces must not be
  // expanded into one row per marketplace, or the totals row would count the
  // same orders/earnings once per marketplace.
  const rows: ReportRow[] = [...totals].map(([tag, tagTotals]) => ({
    marketplaces: tagToMarketplaces.get(tag) ?? ['?'],
    tag,
    totals: tagTotals,
  }))

  let minDate = parsed.rows[0]?.date ?? ''
  let maxDate = minDate
  for (const row of parsed.rows) {
    if (row.date < minDate) minDate = row.date
    if (row.date > maxDate) maxDate = row.date
  }

  // A malformed --dataset is caller error and fails hard, matching `stats`.
  // Environmental problems (missing credentials, API errors) degrade to the
  // earnings-only view instead — the report on screen is still useful.
  const dataset = values.dataset ?? DEFAULT_DATASET
  if (!isSafeDatasetName(dataset)) {
    console.error(
      `✗ --dataset "${dataset}" is not a safe identifier (it is interpolated directly into SQL as a table name) — use letters, digits and underscores, not starting with a digit`,
    )
    return 1
  }

  const clicksByMarketplace = new Map<string, number>()
  if (values['no-clicks']) {
    console.log('note: --no-clicks — showing earnings only')
  } else {
    const credentials = credentialsFromEnv()
    if (credentials === undefined) {
      console.log(
        'note: CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN not set — showing earnings only (no clicks column); set them to see clicks',
      )
    } else {
      const sql = `SELECT blob2 AS marketplace, SUM(_sample_interval) AS clicks FROM ${dataset} WHERE timestamp >= toDateTime('${minDate} 00:00:00') AND timestamp <= toDateTime('${maxDate} 23:59:59') GROUP BY marketplace FORMAT JSON`
      try {
        const result = await aeQuery(credentials, sql, fetchImpl)
        for (const row of result.rows) {
          const marketplace = String(row['marketplace'] ?? '')
          if (marketplace === '') continue
          clicksByMarketplace.set(marketplace, Number(row['clicks'] ?? 0))
        }
      } catch (error) {
        if (error instanceof AeError) {
          console.error(`  warning: could not fetch click data: ${error.message} — showing earnings only`)
        } else {
          throw error
        }
      }
    }
  }

  printReportTable(rows, clicksByMarketplace)

  return 0
}

function printReportTable(
  rows: readonly ReportRow[],
  clicksByMarketplace: ReadonlyMap<string, number>,
): void {
  const header = ['marketplace', 'tag', 'orders', 'items', 'earnings', 'clicks', 'conv%']
  const tableRows = rows.map((r) => {
    // A tag shared across marketplaces can't have its clicks disambiguated:
    // clicks are attributed per marketplace (blob2) but earnings per tag, so
    // when one tag maps to several marketplaces we don't know which
    // marketplace's clicks "belong" to the tag's orders.
    const single = r.marketplaces.length === 1 ? r.marketplaces[0] : undefined
    const clicks = single !== undefined ? clicksByMarketplace.get(single) : undefined
    const clicksCell = clicks !== undefined ? String(clicks) : '—'
    const convCell =
      clicks !== undefined && clicks > 0
        ? `${((r.totals.orders / clicks) * 100).toFixed(1)}%`
        : '—'
    return [
      r.marketplaces.join(', '),
      r.tag,
      String(r.totals.orders),
      String(r.totals.items),
      r.totals.earnings.toFixed(2),
      clicksCell,
      convCell,
    ]
  })

  // One row per tag (see the caller), so summing rows counts each order once.
  const totalOrders = rows.reduce((sum, r) => sum + r.totals.orders, 0)
  const totalItems = rows.reduce((sum, r) => sum + r.totals.items, 0)
  const totalClicks = [...clicksByMarketplace.values()].reduce((sum, c) => sum + c, 0)
  const anyClicks = clicksByMarketplace.size > 0

  // Reports are per-marketplace currencies (EUR vs GBP vs USD, ...). Summing
  // earnings across rows is only meaningful when every row belongs to the
  // same marketplace — otherwise we'd silently add incompatible currencies
  // into one number that looks precise but means nothing. Keep the rule
  // simple: one marketplace → sum it; more than one → print "—" with a note.
  const distinctMarketplaces = new Set(rows.flatMap((r) => r.marketplaces))
  const totalEarnings =
    distinctMarketplaces.size <= 1
      ? rows.reduce((sum, r) => sum + r.totals.earnings, 0).toFixed(2)
      : '— (mixed currencies)'

  const totalsRow = [
    'TOTAL',
    '',
    String(totalOrders),
    String(totalItems),
    totalEarnings,
    anyClicks ? String(totalClicks) : '—',
    anyClicks && totalClicks > 0 ? `${((totalOrders / totalClicks) * 100).toFixed(1)}%` : '—',
  ]

  printTable(header, [...tableRows, totalsRow])
}
