#!/usr/bin/env node
import { argv, exit } from 'node:process'
import { runCheck } from './commands/check.js'
import { runInit } from './commands/init.js'
import { runValidate } from './commands/validate.js'

const HELP = `TagFlow — localized Amazon affiliate links on Cloudflare Workers

Usage:
  tagflow init [--out <file>] [--default <marketplace>] [--tag mp=tag ...] [--force]
      Scaffold an affiliate.config.json (interactive unless flags cover it).

  tagflow validate [config-path]
      Validate the config; exit 1 on errors (CI-friendly).

  tagflow check [config-path] [--engine probe|paapi] [--write] [--delay-ms <n>]
      Verify each product × tagged marketplace listing. Updates availableIn
      with --write. Exit 2 when a previously-available listing disappeared.
      The paapi engine reads PAAPI_ACCESS_KEY / PAAPI_SECRET_KEY env vars.

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
