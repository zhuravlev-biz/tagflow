import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckEngine, ListingStatus } from '../src/check/engines.js'
import { checkTargets, evaluate, runCheck } from '../src/commands/check.js'
import { runInit } from '../src/commands/init.js'
import { runValidate } from '../src/commands/validate.js'
import { loadConfigFile } from '../src/config-io.js'

const VALID_CONFIG = {
  defaultMarketplace: 'es',
  tags: { es: 'tag-es-21', de: 'tag-de-21' },
  countryOverrides: {},
  marketplaceFallbacks: {},
  unknownAsin: 'default',
  products: {
    widget: { asin: 'B000000001', availableIn: ['es', 'de'] },
    gadget: { asin: 'B000000002', asinByMarketplace: { de: 'B0000000DE' }, availableIn: ['es'] },
  },
}

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tagflow-test-'))
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
})

function fakeEngine(statuses: Record<string, Record<string, ListingStatus>>): CheckEngine {
  return {
    name: 'fake',
    check: async (marketplace, asins) =>
      new Map(asins.map((asin) => [asin, statuses[marketplace]?.[asin] ?? 'unknown'])),
  }
}

describe('validate command', () => {
  it('exits 0 for a valid config', async () => {
    const path = join(dir, 'affiliate.config.json')
    await writeFile(path, JSON.stringify(VALID_CONFIG))
    expect(await runValidate([path])).toBe(0)
  })

  it('exits 1 with precise errors for an invalid config', async () => {
    const path = join(dir, 'affiliate.config.json')
    await writeFile(path, JSON.stringify({ ...VALID_CONFIG, defaultMarketplace: 'fr' }))
    expect(await runValidate([path])).toBe(1)
    const output = vi.mocked(console.error).mock.calls.flat().join('\n')
    expect(output).toContain('defaultMarketplace')
  })

  it('exits 1 for a missing file', async () => {
    expect(await runValidate([join(dir, 'nope.json')])).toBe(1)
  })
})

describe('init command', () => {
  it('scaffolds a valid config non-interactively', async () => {
    const path = join(dir, 'affiliate.config.json')
    const code = await runInit(['--out', path, '--default', 'es', '--tag', 'es=yourtag-21'])
    expect(code).toBe(0)
    const loaded = await loadConfigFile(path)
    expect(loaded.config.defaultMarketplace).toBe('es')
    expect(loaded.config.tags.es).toBe('yourtag-21')
  })

  it('refuses to overwrite without --force', async () => {
    const path = join(dir, 'affiliate.config.json')
    await writeFile(path, '{}')
    expect(await runInit(['--out', path, '--default', 'es', '--tag', 'es=x-21'])).toBe(1)
  })

  it('rejects an invalid default marketplace tag pairing', async () => {
    const path = join(dir, 'affiliate.config.json')
    expect(await runInit(['--out', path, '--default', 'es', '--tag', 'de=x-21'])).toBe(1)
  })
})

describe('checkTargets / evaluate', () => {
  const config = (() => {
    const targets = checkTargets({
      ...VALID_CONFIG,
      products: VALID_CONFIG.products,
    } as never)
    return targets
  })()

  it('enumerates every product × tagged marketplace with per-marketplace ASINs', () => {
    expect(config).toHaveLength(4)
    const gadgetDe = config.find((t) => t.productKey === 'gadget' && t.marketplace === 'de')
    expect(gadgetDe?.asin).toBe('B0000000DE')
    expect(gadgetDe?.listed).toBe(false)
  })

  it('maps statuses to actions', () => {
    const base = { productKey: 'p', marketplace: 'de', asin: 'A', listed: false, isDefault: false } as const
    expect(evaluate({ ...base, listed: true }, 'ok')).toBe('keep')
    expect(evaluate(base, 'ok')).toBe('add')
    expect(evaluate({ ...base, listed: true }, 'missing')).toBe('remove')
    expect(evaluate(base, 'missing')).toBe('absent')
    expect(evaluate({ ...base, isDefault: true }, 'missing')).toBe('dead-default')
    expect(evaluate({ ...base, listed: true }, 'unknown')).toBe('unverified')
  })
})

describe('check command', () => {
  it('exits 0 and suggests additions without --write', async () => {
    const path = join(dir, 'affiliate.config.json')
    await writeFile(path, JSON.stringify(VALID_CONFIG))
    const engine = fakeEngine({
      es: { B000000001: 'ok', B000000002: 'ok' },
      de: { B000000001: 'ok', B0000000DE: 'ok' },
    })
    expect(await runCheck([path], engine)).toBe(0)
    // Config untouched without --write.
    const loaded = await loadConfigFile(path)
    expect(loaded.config.products['gadget']?.availableIn).toEqual(['es'])
  })

  it('applies additions and removals with --write', async () => {
    const path = join(dir, 'affiliate.config.json')
    await writeFile(path, JSON.stringify(VALID_CONFIG))
    const engine = fakeEngine({
      es: { B000000001: 'ok', B000000002: 'ok' },
      // widget disappeared from de; gadget's de listing exists now.
      de: { B000000001: 'missing', B0000000DE: 'ok' },
    })
    const code = await runCheck([path, '--write'], engine)
    expect(code).toBe(2) // widget/de was listed and is gone → regression
    const loaded = await loadConfigFile(path)
    expect(loaded.config.products['widget']?.availableIn).toEqual(['es'])
    expect(loaded.config.products['gadget']?.availableIn).toEqual(['de', 'es'])
  })

  it('leaves unverified listings untouched and exits 0', async () => {
    const path = join(dir, 'affiliate.config.json')
    await writeFile(path, JSON.stringify(VALID_CONFIG))
    const engine = fakeEngine({}) // everything unknown
    expect(await runCheck([path, '--write'], engine)).toBe(0)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(VALID_CONFIG)
  })

  it('exits 2 when the default marketplace listing is dead', async () => {
    const path = join(dir, 'affiliate.config.json')
    await writeFile(path, JSON.stringify(VALID_CONFIG))
    const engine = fakeEngine({
      es: { B000000001: 'missing', B000000002: 'ok' },
      de: { B000000001: 'ok', B0000000DE: 'ok' },
    })
    expect(await runCheck([path], engine)).toBe(2)
  })

  it('exits 1 on an invalid config file', async () => {
    const path = join(dir, 'affiliate.config.json')
    await writeFile(path, '{not json')
    expect(await runCheck([path], fakeEngine({}))).toBe(1)
  })
})
