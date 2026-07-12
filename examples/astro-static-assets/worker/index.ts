import { createAffiliateHandler } from '@tagflow/cloudflare'
import config from '../affiliate.config.json'

interface Env {
  ASSETS: Fetcher
  CLICKS?: AnalyticsEngineDataset
}

const affiliate = createAffiliateHandler(config)

// The mounted-mode contract (F7): the affiliate handler answers for /go/*
// and returns null for everything else — including unknown product keys —
// so the site's static assets (and its 404 page) keep working untouched.
export default {
  async fetch(request, env, ctx) {
    return (await affiliate(request, env, ctx)) ?? env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
