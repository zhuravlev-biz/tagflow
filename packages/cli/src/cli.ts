#!/usr/bin/env node
import { argv, exit } from 'node:process'
import { runCheck } from './commands/check.js'
import { runImportEarnings } from './commands/import-earnings.js'
import { runInit } from './commands/init.js'
import { runStats } from './commands/stats.js'
import { runValidate } from './commands/validate.js'

const HELP = `TagFlow — localized Amazon affiliate links on Cloudflare Workers

Usage:
  tagflow init [--out <file>] [--default <marketplace>] [--tag mp=tag ...] [--force]
      Scaffold an affiliate.config.json (interactive unless flags cover it).

  tagflow validate [config-path]
      Validate the config; exit 1 on errors (CI-friendly).

  tagflow check [config-path] [--engine probe|creatorsapi] [--write] [--delay-ms <n>]
      Verify each product × tagged marketplace listing. Updates availableIn
      with --write. Exit 2 when a previously-available listing disappeared.
      The creatorsapi engine reads CREATORSAPI_CREDENTIAL_ID /
      CREATORSAPI_CREDENTIAL_SECRET env vars.

  tagflow stats [--dataset <name>] [--days <n>] [--limit <n>] [--leaks]
      Click stats from Workers Analytics Engine; --leaks shows clicks that
      fell back past their geo marketplace (the revenue-leak monitor).
      Reads CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN env vars.

  tagflow import-earnings <report.csv> [config-path] [--dataset <name>] [--no-clicks]
      Join an Associates earnings report against click data by tracking
      tag + date: clicks vs orders per marketplace.

  tagflow help
      Show this message.
`

async function main(): Promise<number> {
  const [command, ...rest] = argv.slice(2)
  switch (command) {
    case 'init':
      return runInit(rest)
    case 'validate':
      return runValidate(rest)
    case 'check':
      return runCheck(rest)
    case 'stats':
      return runStats(rest)
    case 'import-earnings':
      return runImportEarnings(rest)
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP)
      return command === undefined ? 1 : 0
    default:
      console.error(`✗ unknown command "${command}"\n`)
      console.log(HELP)
      return 1
  }
}

main().then(
  (code) => exit(code),
  (error) => {
    console.error(error)
    exit(1)
  },
)
