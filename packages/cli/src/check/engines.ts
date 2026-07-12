import { AMAZON_DOMAINS, type MarketplaceId } from '@tagflow/core'
import { signRequest } from './sigv4.js'

export type ListingStatus = 'ok' | 'missing' | 'unknown'

export interface CheckEngine {
  readonly name: string
  /** Check the given ASINs on one marketplace; returns a status per ASIN. */
  check(marketplace: MarketplaceId, asins: readonly string[]): Promise<Map<string, ListingStatus>>
}

export interface EngineIo {
  readonly fetchFn?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
  readonly random?: () => number
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Plain HTTPS probe of the public `/dp/` page (§10). Runs client-side from
 * the user's own IP at their own discretion — never from Workers or other
 * datacenter infrastructure. Rate-limited with jitter, sends no affiliate
 * tag, and reports `unknown` whenever Amazon answers with anything that is
 * not a clear yes/no (robot checks, 503s, network errors).
 */
export function createProbeEngine(options: { delayMs?: number } & EngineIo = {}): CheckEngine {
  const fetchFn = options.fetchFn ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random
  const delayMs = options.delayMs ?? 2000

  return {
    name: 'probe',
    async check(marketplace, asins) {
      const results = new Map<string, ListingStatus>()
      let first = true
      for (const asin of asins) {
        if (!first) await sleep(delayMs + Math.floor(random() * 1000))
        first = false
        try {
          const response = await fetchFn(
            `https://${AMAZON_DOMAINS[marketplace]}/dp/${encodeURIComponent(asin)}`,
            {
              redirect: 'follow',
              headers: {
                'user-agent': 'tagflow-check/0.1 (affiliate config availability checker)',
                accept: 'text/html',
              },
            },
          )
          if (response.status === 200) results.set(asin, 'ok')
          else if (response.status === 404 || response.status === 410) results.set(asin, 'missing')
          else results.set(asin, 'unknown')
          // Response bodies are irrelevant; make sure connections are freed.
          await response.body?.cancel()
        } catch {
          results.set(asin, 'unknown')
        }
      }
      return results
    },
  }
}

export interface PaapiCredentials {
  readonly accessKey: string
  readonly secretKey: string
  /** Partner tag per marketplace — taken from the config's `tags`. */
  readonly partnerTagFor: (marketplace: MarketplaceId) => string | undefined
}

/** PA-API 5 endpoints per marketplace (host + signing region). */
export const PAAPI_ENDPOINTS: Readonly<
  Partial<Record<MarketplaceId, { host: string; region: string }>>
> = {
  com: { host: 'webservices.amazon.com', region: 'us-east-1' },
  'co.uk': { host: 'webservices.amazon.co.uk', region: 'eu-west-1' },
  de: { host: 'webservices.amazon.de', region: 'eu-west-1' },
  fr: { host: 'webservices.amazon.fr', region: 'eu-west-1' },
  it: { host: 'webservices.amazon.it', region: 'eu-west-1' },
  es: { host: 'webservices.amazon.es', region: 'eu-west-1' },
  nl: { host: 'webservices.amazon.nl', region: 'eu-west-1' },
  pl: { host: 'webservices.amazon.pl', region: 'eu-west-1' },
  se: { host: 'webservices.amazon.se', region: 'eu-west-1' },
  'com.be': { host: 'webservices.amazon.com.be', region: 'eu-west-1' },
  ca: { host: 'webservices.amazon.ca', region: 'us-east-1' },
  'com.mx': { host: 'webservices.amazon.com.mx', region: 'us-east-1' },
  'com.br': { host: 'webservices.amazon.com.br', region: 'us-east-1' },
  'co.jp': { host: 'webservices.amazon.co.jp', region: 'us-west-2' },
  in: { host: 'webservices.amazon.in', region: 'eu-west-1' },
  sg: { host: 'webservices.amazon.sg', region: 'us-west-2' },
  'com.au': { host: 'webservices.amazon.com.au', region: 'us-west-2' },
  ae: { host: 'webservices.amazon.ae', region: 'eu-west-1' },
  sa: { host: 'webservices.amazon.sa', region: 'eu-west-1' },
  'com.tr': { host: 'webservices.amazon.com.tr', region: 'eu-west-1' },
  eg: { host: 'webservices.amazon.eg', region: 'eu-west-1' },
}

interface PaapiGetItemsResponse {
  ItemsResult?: { Items?: { ASIN?: string }[] }
  Errors?: { Code?: string; Message?: string }[]
}

/**
 * PA-API 5 GetItems engine — the blessed path when the user has API keys.
 * Batches up to 10 ASINs per request, 1 request/second.
 */
export function createPaapiEngine(
  credentials: PaapiCredentials,
  options: { delayMs?: number; now?: () => Date } & EngineIo = {},
): CheckEngine {
  const fetchFn = options.fetchFn ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const delayMs = options.delayMs ?? 1100
  const now = options.now ?? (() => new Date())

  return {
    name: 'paapi',
    async check(marketplace, asins) {
      const results = new Map<string, ListingStatus>()
      const endpoint = PAAPI_ENDPOINTS[marketplace]
      const partnerTag = credentials.partnerTagFor(marketplace)
      if (endpoint === undefined || partnerTag === undefined) {
        for (const asin of asins) results.set(asin, 'unknown')
        return results
      }

      for (let i = 0; i < asins.length; i += 10) {
        if (i > 0) await sleep(delayMs)
        const batch = asins.slice(i, i + 10)
        const body = JSON.stringify({
          ItemIds: batch,
          ItemIdType: 'ASIN',
          PartnerTag: partnerTag,
          PartnerType: 'Associates',
          Marketplace: AMAZON_DOMAINS[marketplace],
          Resources: [],
        })
        const path = '/paapi5/getitems'
        const headers = signRequest({
          method: 'POST',
          host: endpoint.host,
          path,
          region: endpoint.region,
          service: 'ProductAdvertisingAPI',
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'content-encoding': 'amz-1.0',
            'x-amz-target': 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems',
          },
          body,
          accessKey: credentials.accessKey,
          secretKey: credentials.secretKey,
          date: now(),
        })

        try {
          const response = await fetchFn(`https://${endpoint.host}${path}`, {
            method: 'POST',
            headers,
            body,
          })
          if (response.status !== 200 && response.status !== 404) {
            // Auth/throttle problems affect the whole batch.
            for (const asin of batch) results.set(asin, 'unknown')
            continue
          }
          const payload = (await response.json()) as PaapiGetItemsResponse
          const found = new Set(
            (payload.ItemsResult?.Items ?? [])
              .map((item) => item.ASIN)
              .filter((asin): asin is string => typeof asin === 'string'),
          )
          for (const asin of batch) {
            // PA-API reports unknown/unbuyable ASINs via Errors + omission
            // from ItemsResult — both mean the listing is dead for linking.
            results.set(asin, found.has(asin) ? 'ok' : 'missing')
          }
        } catch {
          for (const asin of batch) results.set(asin, 'unknown')
        }
      }
      return results
    },
  }
}
