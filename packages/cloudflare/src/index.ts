export {
  createAffiliateHandler,
  type AffiliateHandler,
  type AffiliateHandlerOptions,
} from './handler.js'
export { createAffiliateWorker, type AffiliateWorker } from './worker.js'
export { renderChoicePage } from './choice-page.js'
export { classifyUserAgent } from './ua.js'
export type {
  AnalyticsEngineDataset,
  ExecutionContextLike,
  IncomingRequest,
  IncomingRequestCf,
  UaClass,
} from './types.js'
