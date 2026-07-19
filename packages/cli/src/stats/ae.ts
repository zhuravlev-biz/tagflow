import { env } from 'node:process'

/**
 * Minimal Workers Analytics Engine SQL API client (§9, §10). Runs on the
 * user's machine only — never in the Worker. Credentials come from the same
 * env vars wrangler uses: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
 * (token needs the "Account Analytics: Read" permission).
 */

/** Matches the AE binding's dataset in `templates/worker/wrangler.jsonc`. */
export const DEFAULT_DATASET = 'affiliate_clicks'

export interface AeCredentials {
  readonly accountId: string
  readonly apiToken: string
}

export class AeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AeError'
  }
}

/** Rows as returned by `FORMAT JSON`: column name → string/number value. */
export type AeRow = Readonly<Record<string, string | number>>

export interface AeQueryResult {
  readonly rows: readonly AeRow[]
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export function credentialsFromEnv(): AeCredentials | undefined {
  const accountId = env['CLOUDFLARE_ACCOUNT_ID']
  const apiToken = env['CLOUDFLARE_API_TOKEN']
  if (accountId === undefined || accountId === '' || apiToken === undefined || apiToken === '') {
    return undefined
  }
  return { accountId, apiToken }
}

/**
 * Dataset names are interpolated into SQL as identifiers (the AE SQL API has
 * no bind parameters), so restrict them to a safe shape instead of quoting.
 */
export function isSafeDatasetName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
}

/**
 * Run one SQL statement against the AE SQL API. The query must end with
 * `FORMAT JSON` (the response parser relies on it).
 */
export async function aeQuery(
  credentials: AeCredentials,
  sql: string,
  fetchImpl: FetchLike = fetch,
): Promise<AeQueryResult> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/analytics_engine/sql`
  let response: Awaited<ReturnType<FetchLike>>
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credentials.apiToken}`,
        'content-type': 'text/plain; charset=utf-8',
      },
      body: sql,
    })
  } catch (error) {
    throw new AeError(`Analytics Engine SQL API unreachable: ${(error as Error).message}`)
  }
  const text = await response.text()
  if (!response.ok) {
    // Error bodies are plain text (often with the offending SQL echoed);
    // first line is enough for a useful message.
    const firstLine = text.split('\n', 1)[0] ?? ''
    throw new AeError(`Analytics Engine SQL API returned ${response.status}: ${firstLine}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AeError('Analytics Engine SQL API returned a non-JSON body (did the query end with FORMAT JSON?)')
  }
  const data = (parsed as { data?: unknown }).data
  if (!Array.isArray(data)) {
    throw new AeError('unexpected Analytics Engine response shape: missing "data" array')
  }
  return { rows: data as AeRow[] }
}
