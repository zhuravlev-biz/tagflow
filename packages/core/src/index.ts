export {
  MARKETPLACE_IDS,
  AMAZON_DOMAINS,
  isMarketplaceId,
  type MarketplaceId,
} from './marketplaces.js'
export {
  COUNTRY_TO_MARKETPLACE,
  ISO_3166_ALPHA2,
  marketplaceForCountry,
} from './country-map.js'
export {
  parseConfig,
  RESERVED_PRODUCT_KEYS,
  type Config,
  type ProductConfig,
  type ParseConfigResult,
  type ValidationIssue,
} from './config.js'
export {
  resolve,
  type ClickContext,
  type Decision,
  type ResolutionReason,
} from './resolve.js'
export { goUrl, goAmazonUrl, type GoUrlOptions } from './go-url.js'
