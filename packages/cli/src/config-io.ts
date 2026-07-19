import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { pid } from 'node:process'
import { parseConfig, type Config, type ValidationIssue } from '@tagflow/core'

export interface LoadedConfig {
  readonly path: string
  /** The raw parsed JSON, preserved for round-tripping (`check --write`). */
  readonly raw: Record<string, unknown>
  readonly config: Config
  readonly warnings: readonly ValidationIssue[]
}

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly issues: readonly ValidationIssue[] = [],
  ) {
    super(message)
    this.name = 'ConfigError'
  }
}

export const DEFAULT_CONFIG_PATH = 'affiliate.config.json'

export async function loadConfigFile(path: string): Promise<LoadedConfig> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') {
      throw new ConfigError(`config file not found: ${path}`)
    }
    throw new ConfigError(`cannot read config file: ${path} (${nodeError.message})`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${(error as Error).message}`)
  }
  const result = parseConfig(raw)
  if (!result.ok) {
    throw new ConfigError(`${path} failed validation`, result.errors)
  }
  return {
    path,
    raw: raw as Record<string, unknown>,
    config: result.config,
    warnings: result.warnings,
  }
}

export async function writeConfigFile(
  path: string,
  raw: Record<string, unknown>,
): Promise<void> {
  // Write to a temp file in the same directory, then rename over the target,
  // so a crash mid-write can never leave a truncated/corrupt config on disk.
  const tmpPath = `${path}.${pid}.tmp`
  try {
    await writeFile(tmpPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
    await rename(tmpPath, path)
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined)
    throw error
  }
}

export function printIssues(issues: readonly ValidationIssue[], kind: 'error' | 'warning'): void {
  for (const issue of issues) {
    const location = issue.path === '' ? '(root)' : issue.path
    console.error(`  ${kind}: ${location} — ${issue.message}`)
  }
}
