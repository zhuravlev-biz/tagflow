import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfigFile, writeConfigFile } from '../src/config-io.js'

// writeConfigFile must write atomically: a temp file in the same directory,
// then a rename over the target, so a crash mid-write can't truncate
// affiliate.config.json. `rename` is mocked to fail on demand to exercise
// that path without actually crashing the process.
let shouldFailRename = false
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (shouldFailRename) throw new Error('simulated rename failure')
      return actual.rename(...args)
    },
  }
})

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tagflow-configio-'))
  shouldFailRename = false
})
afterEach(() => {
  shouldFailRename = false
})

describe('writeConfigFile', () => {
  it('writes atomically via a temp file, leaving nothing stray behind on success', async () => {
    const path = join(dir, 'affiliate.config.json')
    await writeConfigFile(path, { a: 1 })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ a: 1 })
    expect(await readdir(dir)).toEqual(['affiliate.config.json'])
  })

  it('cleans up the temp file and propagates the error when the rename fails', async () => {
    const path = join(dir, 'affiliate.config.json')
    shouldFailRename = true
    await expect(writeConfigFile(path, { a: 1 })).rejects.toThrow('simulated rename failure')
    // No leftover temp file, and the target was never created (write never
    // truncated/replaced it).
    expect(await readdir(dir)).toEqual([])
  })
})

describe('loadConfigFile', () => {
  it('reports a clear "not found" error for a missing file', async () => {
    const path = join(dir, 'nope.json')
    await expect(loadConfigFile(path)).rejects.toThrow(`config file not found: ${path}`)
  })

  it('reports a distinct error (with cause) for a non-ENOENT read failure', async () => {
    // Reading a directory as a file fails with EISDIR, not ENOENT.
    await expect(loadConfigFile(dir)).rejects.toThrow(/cannot read config file: .*EISDIR/)
  })
})
