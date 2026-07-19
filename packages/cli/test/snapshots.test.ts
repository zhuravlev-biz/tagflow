import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CheckEngine, ListingStatus } from '../src/check/engines.js'
import { runCheck } from '../src/commands/check.js'
import { runValidate } from '../src/commands/validate.js'

// snapshot tests for `validate`/`check` stdout+stderr (design doc §12: "cli:
// snapshot tests for validate/check output; probe engine mocked"). These
// compare the *exact* rendered output (message text, table alignment, line
// order) against committed fixtures under snapshots/ — a stricter guarantee
// than the exit-code/parsed-state assertions in commands.test.ts, which this
// file complements rather than replaces.
//
// The check engine is always a hand-built fake (never `createProbeEngine` /
// `createCreatorsApiEngine`), so none of this ever touches the network — see
// the `fakeEngine` helper below.

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url))
const fixture = (name: string): string => join(FIXTURES_DIR, name)

/**
 * Normalizes the parts of captured output that are not the thing under test:
 *  - the fixtures directory's absolute path (machine/checkout-dependent)
 *  - a per-test tmp directory's absolute path (random suffix from `mkdtemp`)
 *  - the JSON.parse error suffix in "not valid JSON" messages, whose exact
 *    wording is a V8/Node-version detail, not something this suite should pin
 */
function normalize(text: string, tmpDir?: string): string {
  let out = text
  if (tmpDir !== undefined) out = out.split(tmpDir).join('<tmp>')
  out = out.split(FIXTURES_DIR).join('<fixtures>/')
  out = out.replace(/is not valid JSON: .*/g, 'is not valid JSON: <parse-error>')
  return out
}

/** Captures console.log/console.error calls, each joined the way `console`
 * would join multiple args, one entry per call, in call order. */
function captureConsole(): { stdout: () => string; stderr: () => string } {
  const outLines: string[] = []
  const errLines: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    outLines.push(args.map(String).join(' '))
  })
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errLines.push(args.map(String).join(' '))
  })
  return {
    stdout: () => (outLines.length > 0 ? `${outLines.join('\n')}\n` : ''),
    stderr: () => (errLines.length > 0 ? `${errLines.join('\n')}\n` : ''),
  }
}

function fakeEngine(
  name: string,
  statuses: Record<string, Record<string, ListingStatus>>,
): CheckEngine {
  return {
    name,
    check: async (marketplace, asins) =>
      new Map(asins.map((asin) => [asin, statuses[marketplace]?.[asin] ?? 'unknown'])),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('validate snapshot output', () => {
  it('renders a clean success line for a valid, warning-free config', async () => {
    const capture = captureConsole()
    const code = await runValidate([fixture('valid.json')])
    expect(code).toBe(0)
    await expect(normalize(capture.stdout())).toMatchFileSnapshot('snapshots/validate-valid.stdout.txt')
    await expect(normalize(capture.stderr())).toMatchFileSnapshot('snapshots/validate-valid.stderr.txt')
  })

  it('renders warnings (tag shape, unknown ISO code, ASIN shape) then still succeeds', async () => {
    const capture = captureConsole()
    const code = await runValidate([fixture('warnings.json')])
    expect(code).toBe(0)
    await expect(normalize(capture.stdout())).toMatchFileSnapshot(
      'snapshots/validate-warnings.stdout.txt',
    )
    await expect(normalize(capture.stderr())).toMatchFileSnapshot(
      'snapshots/validate-warnings.stderr.txt',
    )
  })

  it('renders precise errors and fails for an invalid config', async () => {
    const capture = captureConsole()
    const code = await runValidate([fixture('invalid.json')])
    expect(code).toBe(1)
    await expect(normalize(capture.stdout())).toMatchFileSnapshot(
      'snapshots/validate-invalid.stdout.txt',
    )
    await expect(normalize(capture.stderr())).toMatchFileSnapshot(
      'snapshots/validate-invalid.stderr.txt',
    )
  })

  it('renders a JSON-parse failure distinctly from a validation failure', async () => {
    const capture = captureConsole()
    const code = await runValidate([fixture('malformed.json')])
    expect(code).toBe(1)
    await expect(normalize(capture.stdout())).toMatchFileSnapshot(
      'snapshots/validate-malformed.stdout.txt',
    )
    await expect(normalize(capture.stderr())).toMatchFileSnapshot(
      'snapshots/validate-malformed.stderr.txt',
    )
  })

  it('renders a "not found" error for a missing config path', async () => {
    const capture = captureConsole()
    const code = await runValidate([fixture('nope-does-not-exist.json')])
    expect(code).toBe(1)
    await expect(normalize(capture.stdout())).toMatchFileSnapshot(
      'snapshots/validate-missing.stdout.txt',
    )
    await expect(normalize(capture.stderr())).toMatchFileSnapshot(
      'snapshots/validate-missing.stderr.txt',
    )
  })
})

describe('check snapshot output', () => {
  it('renders the availability table, re-run hint and regression error (no --write)', async () => {
    const capture = captureConsole()
    const engine = fakeEngine('probe', {
      com: { B000000001: 'ok', B000000002: 'missing', B000000003: 'unknown', B000000004: 'ok' },
      de: { B000000001: 'missing', B000000002: 'ok' }, // B000000003 left unset → falls back to "unknown"
    })
    const code = await runCheck([fixture('check-matrix.json')], engine)
    expect(code).toBe(2) // alpha/de regressed (remove) and beta/com regressed (dead-default)
    await expect(normalize(capture.stdout())).toMatchFileSnapshot(
      'snapshots/check-matrix-no-write.stdout.txt',
    )
    await expect(normalize(capture.stderr())).toMatchFileSnapshot(
      'snapshots/check-matrix-no-write.stderr.txt',
    )
  })

  it('renders the write-confirmation line instead of the re-run hint with --write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tagflow-snapshot-'))
    const path = join(dir, 'affiliate.config.json')
    await writeFile(path, await readFile(fixture('check-matrix.json'), 'utf8'))

    const capture = captureConsole()
    const engine = fakeEngine('probe', {
      com: { B000000001: 'ok', B000000002: 'missing', B000000003: 'unknown', B000000004: 'ok' },
      de: { B000000001: 'missing', B000000002: 'ok' },
    })
    const code = await runCheck([path, '--write'], engine)
    expect(code).toBe(2)
    await expect(normalize(capture.stdout(), dir)).toMatchFileSnapshot(
      'snapshots/check-matrix-write.stdout.txt',
    )
    await expect(normalize(capture.stderr(), dir)).toMatchFileSnapshot(
      'snapshots/check-matrix-write.stderr.txt',
    )

    // The write side effect itself (not the snapshot text) — belt and suspenders.
    const written = JSON.parse(await readFile(path, 'utf8')) as {
      products: Record<string, { availableIn: string[] }>
    }
    expect(written.products['beta']?.availableIn).toEqual(['com', 'de'])
    expect(written.products['alpha']?.availableIn).toEqual(['com'])
  })

  it('renders "nothing to check" for a config with no products', async () => {
    const capture = captureConsole()
    const engine = fakeEngine('probe', {})
    const code = await runCheck([fixture('check-empty.json')], engine)
    expect(code).toBe(0)
    await expect(normalize(capture.stdout())).toMatchFileSnapshot(
      'snapshots/check-empty.stdout.txt',
    )
    await expect(normalize(capture.stderr())).toMatchFileSnapshot(
      'snapshots/check-empty.stderr.txt',
    )
  })

  it('renders an all-ok table with no re-run hint and no regression error', async () => {
    const capture = captureConsole()
    const engine = fakeEngine('probe', {
      com: { B000000001: 'ok' },
      de: { B000000001: 'ok' },
    })
    const code = await runCheck([fixture('check-clean.json')], engine)
    expect(code).toBe(0)
    await expect(normalize(capture.stdout())).toMatchFileSnapshot(
      'snapshots/check-clean.stdout.txt',
    )
    await expect(normalize(capture.stderr())).toMatchFileSnapshot(
      'snapshots/check-clean.stderr.txt',
    )
  })
})
