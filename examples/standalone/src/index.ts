import { createAffiliateWorker } from '@tagflow/cloudflare'
import config from '../affiliate.config.json'

// The entire Worker: redirects under /go, JSON 404 for everything else.
export default createAffiliateWorker(config)
