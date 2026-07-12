import { existsSync } from 'node:fs'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { isMarketplaceId, MARKETPLACE_IDS, parseConfig } from '@tagflow/core'
import { DEFAULT_CONFIG_PATH, printIssues, writeConfigFile } from '../config-io.js'

const NEXT_STEPS = `
Next, choose how to deploy:

  A) Standalone Worker (own route, e.g. links.yoursite.com or yoursite.com/go/*)
     Copy templates/worker from the repository, drop this config next to it,
     then: wrangler deploy

  B) Mounted inside your existing Worker (Astro/Next/static-assets sites)
     import config from './affiliate.config.json'
     import { createAffiliateHandler } from '@tagflow/cloudflare'

     const affiliate = createAffiliateHandler(config)

     export default {
       async fetch(request, env, ctx) {
         return (await affiliate(request, env, ctx)) ?? env.ASSETS.fetch(request)
       },
     }

Add products to "products" in the config, then link to them as /go/<key>
(use goUrl() from @tagflow/core in templates). Run "tagflow validate"
after every edit.
`

export async function runInit(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string', default: DEFAULT_CONFIG_PATH },
      default: { type: 'string' },
      tag: { type: 'string', multiple: true },
      force: { type: 'boolean', default: false },
    },
  })

  const out = values.out
  if (existsSync(out) && !values.force) {
    console.error(`✗ ${out} already exists (use --force to overwrite)`)
    return 1
  }

  let defaultMarketplace = values.default
  const tags: Record<string, string> = {}
  for (const pair of values.tag ?? []) {
    const eq = pair.indexOf('=')
    if (eq <= 0) {
      console.error(`✗ --tag expects <marketplace>=<tag>, got "${pair}"`)
      return 1
    }
    tags[pair.slice(0, eq)] = pair.slice(eq + 1)
  }

  // Anything not provided via flags is asked interactively.
  if (defaultMarketplace === undefined || Object.keys(tags).length === 0) {
    const rl = createInterface({ input: stdin, output: stdout })
    try {
      console.log(`Marketplaces: ${MARKETPLACE_IDS.join(', ')}\n`)
      while (defaultMarketplace === undefined) {
        const answer = (await rl.question('Default marketplace (e.g. "com", "de"): ')).trim()
        if (isMarketplaceId(answer)) defaultMarketplace = answer
        else console.log(`  "${answer}" is not a known marketplace, try again.`)
      }
      if (tags[defaultMarketplace] === undefined) {
        tags[defaultMarketplace] = (
          await rl.question(`Associates tag for "${defaultMarketplace}": `)
        ).trim()
      }
      for (;;) {
        const marketplace = (
          await rl.question('Add another tagged marketplace (empty to finish): ')
        ).trim()
        if (marketplace === '') break
        if (!isMarketplaceId(marketplace)) {
          console.log(`  "${marketplace}" is not a known marketplace, try again.`)
          continue
        }
        tags[marketplace] = (await rl.question(`Associates tag for "${marketplace}": `)).trim()
      }
    } finally {
      rl.close()
    }
  }

  const raw = {
    defaultMarketplace,
    tags,
    countryOverrides: {},
    marketplaceFallbacks: {},
    unknownAsin: 'default',
    products: {},
  }

  const result = parseConfig(raw)
  if (!result.ok) {
    console.error('✗ the provided values do not form a valid config:')
    printIssues(result.errors, 'error')
    return 1
  }
  printIssues(result.warnings, 'warning')

  await writeConfigFile(out, raw)
  console.log(`✓ wrote ${out}`)
  console.log(NEXT_STEPS)
  return 0
}
