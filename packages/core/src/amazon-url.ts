import type { Config } from './config.js'
import { MARKETPLACE_IDS, type MarketplaceId } from './marketplaces.js'

/**
 * A parsed Amazon product URL: which storefront it belongs to, the ASIN it
 * points at (when the path shape carries one), and any affiliate tag
 * already present on it.
 */
export interface ParsedAmazonUrl {
  readonly marketplace: MarketplaceId
  readonly asin?: string
  readonly tag?: string
}

/** Why {@link withAffiliateTag} did or did not change the URL. */
export type AffiliateTagReason =
  | 'applied'
  | 'has-own-tag'
  | 'has-other-tag'
  | 'no-tag-for-marketplace'
  | 'not-amazon'

/** Result of {@link withAffiliateTag}. */
export interface AffiliateTagResult {
  /** The (possibly unchanged) URL, as a string. */
  readonly url: string
  /** Whether a tag was actually written. */
  readonly applied: boolean
  readonly reason: AffiliateTagReason
}

/** 10-char ASIN, immediately after `/dp/`, `/gp/product/`, or `/gp/aw/d/`. */
const ASIN_PATH_RE = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Za-z0-9]{10})(?![A-Za-z0-9])/

/**
 * Parses `url` (string or already-constructed `URL`) without ever throwing.
 * Returns `null` for anything that is not a syntactically valid absolute
 * URL, and for anything whose host is not a recognised Amazon storefront —
 * this includes lookalike hosts such as `amazon.es.evil.com` or
 * `notamazon.es`, which only a naive "contains amazon" check would miss.
 */
function tryParseUrl(url: string | URL): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** Original input as a string, without reparsing or normalising it. */
function stringifyInput(url: string | URL): string {
  return typeof url === 'string' ? url : url.toString()
}

/**
 * Matches `hostname` against every marketplace in {@link MARKETPLACE_IDS},
 * as `amazon.<tld>` and its `www.`, `smile.`, and `m.` subdomains. Exact
 * equality only — never a suffix/substring check — so `amazon.es.evil.com`
 * and `notamazon.es` correctly fail to match anything.
 */
function matchMarketplace(hostname: string): MarketplaceId | null {
  const host = hostname.toLowerCase()
  for (const id of MARKETPLACE_IDS) {
    const bare = `amazon.${id}`
    if (host === bare || host === `www.${bare}` || host === `smile.${bare}` || host === `m.${bare}`) {
      return id
    }
  }
  return null
}

/** {@link parseAmazonUrl}'s result, plus the live `URL` it was read from. */
interface ParsedAmazonUrlInternal extends ParsedAmazonUrl {
  readonly urlObj: URL
}

/**
 * Does the actual parsing/matching once so {@link parseAmazonUrl} and
 * {@link withAffiliateTag} never need to reparse the same input twice (and
 * so `withAffiliateTag` never needs a second, defensively-unreachable
 * "what if this reparse fails" branch).
 */
function parseAmazonUrlInternal(url: string | URL): ParsedAmazonUrlInternal | null {
  const parsed = tryParseUrl(url)
  if (parsed === null) return null

  const marketplace = matchMarketplace(parsed.hostname)
  if (marketplace === null) return null

  const asinMatch = ASIN_PATH_RE.exec(parsed.pathname)
  const asin = asinMatch?.[1] === undefined ? undefined : asinMatch[1].toUpperCase()

  const tagParam = parsed.searchParams.get('tag')
  const tag = tagParam !== null && tagParam.length > 0 ? tagParam : undefined

  return {
    marketplace,
    ...(asin !== undefined ? { asin } : {}),
    ...(tag !== undefined ? { tag } : {}),
    urlObj: parsed,
  }
}

/**
 * Parses an Amazon product link into its marketplace, ASIN (when the path
 * carries one), and existing affiliate tag (when the `tag` query param is
 * present and non-empty). Never throws — invalid URL strings and anything
 * that isn't a recognised Amazon storefront (including lookalike hosts)
 * simply return `null`.
 *
 * Pure and read-only: this does not decide whether a tag *should* be
 * applied — see {@link withAffiliateTag} for that, which is meant to run
 * only after an explicit user action (e.g. a click on an extension's own
 * button), not automatically on page load.
 */
export function parseAmazonUrl(url: string | URL): ParsedAmazonUrl | null {
  const parsed = parseAmazonUrlInternal(url)
  if (parsed === null) return null
  return {
    marketplace: parsed.marketplace,
    ...(parsed.asin !== undefined ? { asin: parsed.asin } : {}),
    ...(parsed.tag !== undefined ? { tag: parsed.tag } : {}),
  }
}

/**
 * Applies this site's configured affiliate tag to an Amazon URL — but only
 * by adding a `tag` param that is not already there. It **never** overwrites
 * an existing tag (there is no option to; Amazon Associates and the Chrome
 * Web Store affiliate-link policy both treat silent retagging as abusive),
 * so the caller always learns why nothing changed via `reason`.
 *
 * Every other query param, its position, and the URL's hash are preserved
 * untouched. Non-Amazon input, and Amazon input with no tag configured for
 * its marketplace, are returned unchanged (as given, stringified) rather
 * than throwing.
 *
 * Intended to run only right after an explicit, user-initiated action (a
 * click on an affiliate-extension button with a clear "why", per the Chrome
 * Web Store's affiliate-link policy) — never as a background rewrite of
 * every link on a page.
 */
export function withAffiliateTag(url: string | URL, config: Config): AffiliateTagResult {
  const parsed = parseAmazonUrlInternal(url)
  if (parsed === null) {
    return { url: stringifyInput(url), applied: false, reason: 'not-amazon' }
  }

  const ourTag = config.tags[parsed.marketplace]
  if (ourTag === undefined) {
    return { url: stringifyInput(url), applied: false, reason: 'no-tag-for-marketplace' }
  }

  if (parsed.tag === ourTag) {
    return { url: stringifyInput(url), applied: false, reason: 'has-own-tag' }
  }
  if (parsed.tag !== undefined) {
    return { url: stringifyInput(url), applied: false, reason: 'has-other-tag' }
  }

  const target = parsed.urlObj
  if (target.searchParams.has('tag')) {
    // Only an empty `tag=` can reach here; drop it so Amazon cannot read the
    // blank one first. This path re-serialises the query, which is fine.
    target.searchParams.delete('tag')
  }
  // Append to the raw query rather than `searchParams.set`, which would
  // re-serialise every other param (e.g. `%20` -> `+`).
  const tagPair = `tag=${encodeURIComponent(ourTag)}`
  target.search = target.search.length > 1 ? `${target.search}&${tagPair}` : `?${tagPair}`
  return { url: target.href, applied: true, reason: 'applied' }
}
