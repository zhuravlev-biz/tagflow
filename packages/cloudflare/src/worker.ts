import {
  createAffiliateHandler,
  type AffiliateHandlerOptions,
} from './handler.js'
import type { ExecutionContextLike } from './types.js'

export interface AffiliateWorker {
  fetch(request: Request, env: unknown, ctx: ExecutionContextLike): Promise<Response>
}

/**
 * Ready-made `export default` for the standalone template: the affiliate
 * handler plus a JSON 404 for everything it does not own.
 */
export function createAffiliateWorker(
  config: unknown,
  options: AffiliateHandlerOptions = {},
): AffiliateWorker {
  const handler = createAffiliateHandler(config, options)
  return {
    async fetch(request, env, ctx) {
      return (
        (await handler(request, env, ctx)) ??
        Response.json({ error: 'not found' }, { status: 404 })
      )
    },
  }
}
