import { parseArgs } from 'node:util'
import { ConfigError, DEFAULT_CONFIG_PATH, loadConfigFile, printIssues } from '../config-io.js'

export async function runValidate(argv: string[]): Promise<number> {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true })
  const path = positionals[0] ?? DEFAULT_CONFIG_PATH

  try {
    const { config, warnings } = await loadConfigFile(path)
    if (warnings.length > 0) {
      console.error(`${path}: ${warnings.length} warning(s)`)
      printIssues(warnings, 'warning')
    }
    const taggedCount = Object.keys(config.tags).length
    const productCount = Object.keys(config.products).length
    console.log(
      `✓ ${path} is valid — ${productCount} product(s), ${taggedCount} tagged marketplace(s), default "${config.defaultMarketplace}"`,
    )
    return 0
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`✗ ${error.message}`)
      printIssues(error.issues, 'error')
      return 1
    }
    throw error
  }
}
