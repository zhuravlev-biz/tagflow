import { AMAZON_DOMAINS, type MarketplaceId } from '@tagflow/core'

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
  /**
   * Called with a concise, credential-free diagnostic whenever a check can't
   * get a definitive answer (network error, non-200 response, bad
   * credentials, …) so the cause isn't silently indistinguishable from a
   * normal "unknown". Must never receive secrets or signed headers.
   */
  readonly onWarn?: (message: string) => void
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Amazon serves these on captcha/robot-check interstitials — always with HTTP 200. */
const ROBOT_CHECK_MARKERS = ['captcha', 'api-services-support@amazon.com']

/**
 * A 200 status alone doesn't mean the listing is real: Amazon serves
 * captcha/robot-check pages and redirects dead ASINs to the storefront or a
 * search page, both with HTTP 200. Read the body and the final URL to catch
 * those cases conservatively (falling back to 'unknown', never 'missing',
 * since we genuinely can't tell).
 */
async function classifyOkResponse(response: Response, asin: string): Promise<ListingStatus> {
  const body = await response.text()
  const lower = body.toLowerCase()
  if (ROBOT_CHECK_MARKERS.some((marker) => lower.includes(marker))) return 'unknown'
  // Canonical product pages keep the ASIN in the path (/dp/<ASIN>); a
  // redirect away from it (e.g. to the storefront/search) means the listing
  // is gone. An empty url (some fetch mocks don't populate it) passes.
  if (response.url !== '' && !response.url.includes(asin)) return 'unknown'
  return 'ok'
}

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
  const onWarn = options.onWarn

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
          if (response.status === 404 || response.status === 410) {
            results.set(asin, 'missing')
            await response.body?.cancel()
          } else if (response.status === 200) {
            results.set(asin, await classifyOkResponse(response, asin))
          } else {
            results.set(asin, 'unknown')
            await response.body?.cancel()
          }
        } catch (error) {
          onWarn?.(`probe ${marketplace}/${asin}: ${(error as Error).message}`)
          results.set(asin, 'unknown')
        }
      }
      return results
    },
  }
}

export interface CreatorsApiCredentials {
  readonly credentialId: string
  readonly credentialSecret: string
  /** Partner tag per marketplace — taken from the config's `tags`. */
  readonly partnerTagFor: (marketplace: MarketplaceId) => string | undefined
}

/** Single global endpoint; the target marketplace is signaled by a header/body field instead of the host. */
const CREATORS_API_GETITEMS_URL = 'https://creatorsapi.amazon/catalog/v1/getItems'

/**
 * OAuth2 client-credentials token endpoint for "v3.x" (Login-with-Amazon)
 * Creators API credentials — the flow Associates Central issues by default
 * post-migration. Override via `tokenUrl` for the EU/FE regional variants
 * (`api.amazon.co.uk` / `api.amazon.co.jp`) or a legacy "v2.x" Cognito
 * credential, both shown on the credential's own Associates Central page.
 */
const CREATORS_API_DEFAULT_TOKEN_URL = 'https://api.amazon.com/auth/o2/token'

interface CreatorsApiTokenResponse {
  access_token?: string
  expires_in?: number
}

interface CreatorsApiGetItemsResponse {
  itemsResult?: { items?: { asin?: string }[] }
  errors?: { code?: string; message?: string }[]
}

/**
 * Creators API GetItems engine — the blessed path when the user has API
 * credentials (PA-API's successor; see §10/§15 of the design doc). Batches up
 * to 10 ASINs per request, 1 request/second, and caches the bearer token for
 * the lifetime of the process (a single `check` run), refreshing it 60s
 * before expiry.
 */
export function createCreatorsApiEngine(
  credentials: CreatorsApiCredentials,
  options: { delayMs?: number; tokenUrl?: string; now?: () => Date } & EngineIo = {},
): CheckEngine {
  const fetchFn = options.fetchFn ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const delayMs = options.delayMs ?? 1100
  const tokenUrl = options.tokenUrl ?? CREATORS_API_DEFAULT_TOKEN_URL
  const now = options.now ?? (() => new Date())
  const onWarn = options.onWarn

  let cachedToken: { value: string; expiresAtMs: number } | undefined

  async function getToken(): Promise<string | undefined> {
    if (cachedToken !== undefined && cachedToken.expiresAtMs > now().getTime()) {
      return cachedToken.value
    }
    try {
      const response = await fetchFn(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: credentials.credentialId,
          client_secret: credentials.credentialSecret,
          scope: 'creatorsapi::default',
        }),
      })
      if (response.status !== 200) {
        onWarn?.(`creatorsapi token: HTTP ${response.status}`)
        await response.body?.cancel()
        return undefined
      }
      const payload = (await response.json()) as CreatorsApiTokenResponse
      if (payload.access_token === undefined) {
        onWarn?.('creatorsapi token: response had no access_token')
        return undefined
      }
      const expiresInMs = (payload.expires_in ?? 3600) * 1000
      cachedToken = {
        value: payload.access_token,
        expiresAtMs: now().getTime() + expiresInMs - 60_000,
      }
      return cachedToken.value
    } catch (error) {
      onWarn?.(`creatorsapi token: ${(error as Error).message}`)
      return undefined
    }
  }

  return {
    name: 'creatorsapi',
    async check(marketplace, asins) {
      const results = new Map<string, ListingStatus>()
      const partnerTag = credentials.partnerTagFor(marketplace)
      if (partnerTag === undefined) {
        for (const asin of asins) results.set(asin, 'unknown')
        return results
      }

      const token = await getToken()
      if (token === undefined) {
        for (const asin of asins) results.set(asin, 'unknown')
        return results
      }

      const marketplaceDomain = AMAZON_DOMAINS[marketplace]
      for (let i = 0; i < asins.length; i += 10) {
        if (i > 0) await sleep(delayMs)
        const batch = asins.slice(i, i + 10)
        const body = JSON.stringify({
          itemIds: batch,
          itemIdType: 'ASIN',
          partnerTag,
          partnerType: 'Associates',
          marketplace: marketplaceDomain,
          // resources omitted: the server defaults to ["itemInfo.title"],
          // which is all we need to confirm the ASIN resolves to a live item.
        })

        try {
          const response = await fetchFn(CREATORS_API_GETITEMS_URL, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${token}`,
              'x-marketplace': marketplaceDomain,
            },
            body,
          })
          if (response.status !== 200 && response.status !== 404) {
            // Auth/throttle problems affect the whole batch.
            onWarn?.(`creatorsapi ${marketplace}: HTTP ${response.status}`)
            for (const asin of batch) results.set(asin, 'unknown')
            continue
          }
          const payload = (await response.json()) as CreatorsApiGetItemsResponse
          const found = new Set(
            (payload.itemsResult?.items ?? [])
              .map((item) => item.asin)
              .filter((asin): asin is string => typeof asin === 'string'),
          )
          for (const asin of batch) {
            // Unknown/unbuyable ASINs are reported via `errors` + omission
            // from `itemsResult` — both mean the listing is dead for linking.
            results.set(asin, found.has(asin) ? 'ok' : 'missing')
          }
        } catch (error) {
          onWarn?.(`creatorsapi ${marketplace}: ${(error as Error).message}`)
          for (const asin of batch) results.set(asin, 'unknown')
        }
      }
      return results
    },
  }
}
