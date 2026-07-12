/**
 * Minimal structural types for the Workers runtime surface this adapter
 * touches. Kept local on purpose: the package has zero runtime dependencies
 * and does not force a specific `@cloudflare/workers-types` version on
 * consumers — any object with these shapes (including the real runtime
 * bindings) satisfies them.
 */

export interface AnalyticsEngineDataset {
  writeDataPoint(event: {
    blobs?: string[]
    doubles?: number[]
    indexes?: string[]
  }): void
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void
}

/** `request.cf` as populated by Cloudflare; absent in local dev and tests. */
export interface IncomingRequestCf {
  readonly country?: string
}

export type IncomingRequest = Request & { readonly cf?: IncomingRequestCf }

export type UaClass = 'desktop' | 'mobile' | 'bot'
