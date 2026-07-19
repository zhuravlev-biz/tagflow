import { parseArgs } from 'node:util'
import {
  AeError,
  aeQuery,
  credentialsFromEnv,
  DEFAULT_DATASET,
  isSafeDatasetName,
  type AeCredentials,
  type FetchLike,
} from '../stats/ae.js'
import { printTable } from '../table.js'

const DEFAULT_DAYS = 7
const DEFAULT_LIMIT = 20

const FALLBACK_REASONS = ['fallback-no-tag', 'fallback-unavailable']

/**
 * `tagflow stats` — query the Analytics Engine SQL API for click stats and
 * the §9 "fallback-leak" revenue-leak monitor. Runs on the user's machine
 * only; never touches the Worker.
 *
 * Usage: tagflow stats [--dataset <name>] [--days <n>] [--limit <n>] [--leaks]
 */
export async function runStats(argv: string[], fetchImpl?: FetchLike): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      dataset: { type: 'string', default: DEFAULT_DATASET },
      days: { type: 'string', default: String(DEFAULT_DAYS) },
      limit: { type: 'string', default: String(DEFAULT_LIMIT) },
      leaks: { type: 'boolean', default: false },
    },
  })

  const dataset = values.dataset ?? DEFAULT_DATASET
  if (!isSafeDatasetName(dataset)) {
    console.error(
      `✗ --dataset "${dataset}" is not a safe identifier (it is interpolated directly into SQL as a table name) — use letters, digits and underscores, not starting with a digit`,
    )
    return 1
  }

  const days = Number(values.days)
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    console.error('✗ --days must be an integer between 1 and 90')
    return 1
  }

  const limit = Number(values.limit)
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    console.error('✗ --limit must be an integer between 1 and 1000')
    return 1
  }

  const credentials = credentialsFromEnv()
  if (credentials === undefined) {
    console.error(
      '✗ missing CLOUDFLARE_ACCOUNT_ID and/or CLOUDFLARE_API_TOKEN env vars ' +
        '(the token needs the "Account Analytics: Read" permission)',
    )
    return 1
  }

  try {
    if (values.leaks) {
      return await runLeaksReport(credentials, dataset, days, fetchImpl)
    }
    return await runDefaultReport(credentials, dataset, days, limit, fetchImpl)
  } catch (error) {
    if (error instanceof AeError) {
      console.error(`✗ ${error.message}`)
      return 1
    }
    throw error
  }
}

async function runDefaultReport(
  credentials: AeCredentials,
  dataset: string,
  days: number,
  limit: number,
  fetchImpl: FetchLike | undefined,
): Promise<number> {
  // AE applies sampling, so SUM(_sample_interval) — not count() — gives the
  // true (extrapolated) click count.
  const byMarketplaceReason = await aeQuery(
    credentials,
    `SELECT blob2 AS marketplace, blob4 AS reason, SUM(_sample_interval) AS clicks FROM ${dataset} WHERE timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY marketplace, reason ORDER BY clicks DESC FORMAT JSON`,
    fetchImpl,
  )
  const topProducts = await aeQuery(
    credentials,
    `SELECT blob3 AS product, SUM(_sample_interval) AS clicks FROM ${dataset} WHERE timestamp > NOW() - INTERVAL '${days}' DAY GROUP BY product ORDER BY clicks DESC LIMIT ${limit} FORMAT JSON`,
    fetchImpl,
  )

  if (byMarketplaceReason.rows.length === 0 && topProducts.rows.length === 0) {
    console.log(`no clicks recorded in the last ${days} days`)
    return 0
  }

  console.log(`clicks by marketplace × reason (last ${days} days)`)
  printTable(
    ['marketplace', 'reason', 'clicks'],
    byMarketplaceReason.rows.map((row) => [
      String(row['marketplace'] ?? ''),
      String(row['reason'] ?? ''),
      String(Number(row['clicks'] ?? 0)),
    ]),
  )

  console.log('')
  console.log(`top products (last ${days} days)`)
  printTable(
    ['product', 'clicks'],
    topProducts.rows.map((row) => [
      String(row['product'] ?? ''),
      String(Number(row['clicks'] ?? 0)),
    ]),
  )

  return 0
}

async function runLeaksReport(
  credentials: AeCredentials,
  dataset: string,
  days: number,
  fetchImpl: FetchLike | undefined,
): Promise<number> {
  const reasons = FALLBACK_REASONS.map((r) => `'${r}'`).join(', ')
  const { rows } = await aeQuery(
    credentials,
    `SELECT blob3 AS product, blob2 AS marketplace, blob4 AS reason, SUM(_sample_interval) AS clicks FROM ${dataset} WHERE timestamp > NOW() - INTERVAL '${days}' DAY AND blob4 IN (${reasons}) GROUP BY product, marketplace, reason ORDER BY clicks DESC FORMAT JSON`,
    fetchImpl,
  )

  if (rows.length === 0) {
    console.log(`no fallback clicks in the last ${days} days — no leaks detected`)
    return 0
  }

  console.log(
    "these clicks did not reach their geo marketplace — each row is a potential revenue leak (fallback-unavailable → listing missing/dead in that marketplace; fallback-no-tag → no Associates tag configured for it)",
  )
  printTable(
    ['product', 'marketplace', 'reason', 'clicks'],
    rows.map((row) => [
      String(row['product'] ?? ''),
      String(row['marketplace'] ?? ''),
      String(row['reason'] ?? ''),
      String(Number(row['clicks'] ?? 0)),
    ]),
  )
  return 0
}
