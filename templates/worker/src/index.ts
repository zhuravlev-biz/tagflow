import { createAffiliateHandler } from '@tagflow/cloudflare'
import config from '../affiliate.config.json'

interface Env {
  CLICKS?: AnalyticsEngineDataset
}

const affiliate = createAffiliateHandler(config)

export default {
  async fetch(request, env, ctx) {
    return (
      (await affiliate(request, env, ctx)) ??
      Response.json({ error: 'not found' }, { status: 404 })
    )
  },
} satisfies ExportedHandler<Env>
