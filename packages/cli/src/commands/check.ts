import { env } from 'node:process'
import { parseArgs } from 'node:util'
import type { Config, MarketplaceId } from '@tagflow/core'
import {
  createPaapiEngine,
  createProbeEngine,
  type CheckEngine,
  type ListingStatus,
} from '../check/engines.js'
import {
  ConfigError,
  DEFAULT_CONFIG_PATH,
  type LoadedConfig,
  loadConfigFile,
  printIssues,
  writeConfigFile,
} from '../config-io.js'

export interface CheckTarget {
  readonly productKey: string
  readonly marketplace: MarketplaceId
  readonly asin: string
  readonly listed: boolean
  readonly isDefault: boolean
}

/** One row of work: every product × every tagged marketplace (F5, §10). */
export function checkTargets(config: Config): CheckTarget[] {
  const marketplaces = Object.keys(config.tags) as MarketplaceId[]
  const targets: CheckTarget[] = []
  for (const [productKey, product] of Object.entries(config.products)) {
    for (const marketplace of marketplaces) {
      targets.push({
        productKey,
        marketplace,
        asin: product.asinByMarketplace?.[marketplace] ?? product.asin,
        listed: (product.availableIn ?? []).includes(marketplace),
        isDefault: marketplace === config.defaultMarketplace,
      })
    }
  }
  return targets
}

export type CheckAction =
  | 'keep' // confirmed where already listed
  | 'add' // exists but not listed yet
  | 'remove' // listed but the listing is gone — the revenue leak (regression)
  | 'dead-default' // gone on the default marketplace — worst case (regression)
  | 'absent' // not listed and still not available
  | 'unverified' // engine could not tell; config untouched

export function evaluate(target: CheckTarget, status: ListingStatus): CheckAction {
  if (status === 'unknown') return 'unverified'
  if (status === 'ok') return target.listed || target.isDefault ? 'keep' : 'add'
  if (target.isDefault) return 'dead-default'
  return target.listed ? 'remove' : 'absent'
}

const REGRESSIONS: ReadonlySet<CheckAction> = new Set(['remove', 'dead-default'])

export async function runCheck(
  argv: string[],
  engineOverride?: CheckEngine,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      engine: { type: 'string' },
      write: { type: 'boolean', default: false },
      'delay-ms': { type: 'string' },
    },
  })
  const path = positionals[0] ?? DEFAULT_CONFIG_PATH

  let loaded: LoadedConfig
  try {
    loaded = await loadConfigFile(path)
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`✗ ${error.message}`)
      printIssues(error.issues, 'error')
      return 1
    }
    throw error
  }
  const { config, raw } = loaded

  const engine = engineOverride ?? selectEngine(values.engine, values['delay-ms'], config)
  if (engine === undefined) return 1
  console.log(`checking listings with the "${engine.name}" engine…`)
  if (engine.name === 'probe') {
    console.log(
      'note: the probe fetches public /dp/ pages from YOUR machine and IP, at your discretion —',
    )
    console.log(
      'it is rate-limited, sends no affiliate tag, and must never run from datacenter infrastructure.',
    )
  }

  const targets = checkTargets(config)
  if (targets.length === 0) {
    console.log('nothing to check: no products configured')
    return 0
  }

  // Group by marketplace so engines can batch and pace per storefront.
  const byMarketplace = new Map<MarketplaceId, CheckTarget[]>()
  for (const target of targets) {
    const list = byMarketplace.get(target.marketplace) ?? []
    list.push(target)
    byMarketplace.set(target.marketplace, list)
  }

  const outcomes: { target: CheckTarget; status: ListingStatus; action: CheckAction }[] = []
  for (const [marketplace, group] of byMarketplace) {
    const statuses = await engine.check(marketplace, [...new Set(group.map((t) => t.asin))])
    for (const target of group) {
      const status = statuses.get(target.asin) ?? 'unknown'
      outcomes.push({ target, status, action: evaluate(target, status) })
    }
  }

  printTable(outcomes)

  const adds = outcomes.filter((o) => o.action === 'add')
  const removes = outcomes.filter((o) => o.action === 'remove')
  const regressions = outcomes.filter((o) => REGRESSIONS.has(o.action))

  if (values.write && (adds.length > 0 || removes.length > 0)) {
    applyToRaw(raw, adds, removes)
    await writeConfigFile(path, raw)
    console.log(`✓ wrote ${path} (+${adds.length} added, -${removes.length} removed)`)
  } else if (adds.length > 0 || removes.length > 0) {
    console.log(`re-run with --write to apply ${adds.length + removes.length} change(s)`)
  }

  if (regressions.length > 0) {
    console.error(
      `✗ ${regressions.length} previously-available listing(s) disappeared — clicks are leaking`,
    )
    return 2
  }
  return 0
}

function selectEngine(
  engineName: string | undefined,
  delayRaw: string | undefined,
  config: Config,
): CheckEngine | undefined {
  const delayMs = delayRaw === undefined ? undefined : Number(delayRaw)
  if (delayMs !== undefined && (!Number.isFinite(delayMs) || delayMs < 0)) {
    console.error('✗ --delay-ms must be a non-negative number')
    return undefined
  }
  const accessKey = env['PAAPI_ACCESS_KEY']
  const secretKey = env['PAAPI_SECRET_KEY']
  const chosen = engineName ?? (accessKey !== undefined && secretKey !== undefined ? 'paapi' : 'probe')
  const delayOption = delayMs === undefined ? {} : { delayMs }

  if (chosen === 'probe') return createProbeEngine(delayOption)
  if (chosen === 'paapi') {
    if (accessKey === undefined || secretKey === undefined) {
      console.error('✗ the paapi engine needs PAAPI_ACCESS_KEY and PAAPI_SECRET_KEY env vars')
      return undefined
    }
    return createPaapiEngine(
      {
        accessKey,
        secretKey,
        partnerTagFor: (marketplace) => config.tags[marketplace],
      },
      delayOption,
    )
  }
  console.error(`✗ unknown engine "${chosen}" (expected "probe" or "paapi")`)
  return undefined
}

const ACTION_LABELS: Readonly<Record<CheckAction, string>> = {
  keep: '  ok',
  add: '+ add',
  remove: '- REMOVE (was listed!)',
  'dead-default': '! DEAD ON DEFAULT MARKETPLACE',
  absent: '  absent',
  unverified: '? unverified',
}

function printTable(
  outcomes: readonly { target: CheckTarget; status: ListingStatus; action: CheckAction }[],
): void {
  const rows = outcomes.map((o) => [
    o.target.productKey,
    o.target.marketplace,
    o.target.asin,
    o.status,
    ACTION_LABELS[o.action],
  ])
  const header = ['product', 'marketplace', 'asin', 'result', 'action']
  const widths = header.map((h, col) =>
    Math.max(h.length, ...rows.map((row) => (row[col] ?? '').length)),
  )
  const format = (row: readonly string[]): string =>
    row.map((cell, col) => (cell ?? '').padEnd(widths[col] ?? 0)).join('  ')
  console.log(format(header))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const row of rows) console.log(format(row))
}

function applyToRaw(
  raw: Record<string, unknown>,
  adds: readonly { target: CheckTarget }[],
  removes: readonly { target: CheckTarget }[],
): void {
  const products = raw['products'] as Record<string, { availableIn?: string[] }>
  for (const { target } of adds) {
    const product = products[target.productKey]
    if (product === undefined) continue
    const current = new Set(product.availableIn ?? [])
    current.add(target.marketplace)
    product.availableIn = [...current].sort()
  }
  for (const { target } of removes) {
    const product = products[target.productKey]
    if (product === undefined) continue
    product.availableIn = (product.availableIn ?? [])
      .filter((m) => m !== target.marketplace)
      .sort()
  }
}
