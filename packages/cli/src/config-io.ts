import { readFile, writeFile } from 'node:fs/promises'
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
  } catch {
    throw new ConfigError(`cannot read config file: ${path}`)
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
  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, 'utf8')
}

export function printIssues(issues: readonly ValidationIssue[], kind: 'error' | 'warning'): void {
  for (const issue of issues) {
    const location = issue.path === '' ? '(root)' : issue.path
    console.error(`  ${kind}: ${location} — ${issue.message}`)
  }
}
