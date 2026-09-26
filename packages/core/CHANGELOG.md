# @tagflow/core

## 0.4.0

### Minor Changes

- 593f2d7: Add `parseAmazonUrl` and `withAffiliateTag`, two pure, dependency-free URL
  helpers for click-time affiliate tagging (e.g. from a browser extension).

  `parseAmazonUrl(url)` reads an Amazon product link into its marketplace,
  ASIN, and any existing `tag` query param, recognising every storefront in
  `AMAZON_DOMAINS` (plus `www.`/`smile.`/`m.` subdomains) and returning `null`
  — never throwing — for anything else, including lookalike hosts.

  `withAffiliateTag(url, config)` applies this site's configured tag for that
  marketplace, but only when the URL doesn't already carry one — it never
  overwrites an existing tag, own or otherwise — and reports which of
  `applied` / `has-own-tag` / `has-other-tag` / `no-tag-for-marketplace` /
  `not-amazon` applies.

### Patch Changes

- 021467d: Trim leading/trailing slashes in `goUrl`/`goAmazonUrl` and the handler's
  route prefix with a linear scan instead of a backtracking regex. Output is
  unchanged.
- 0288f58: Internal cleanup: `parseConfig` is split into per-section validators and a
  few conditionals in `resolve` and `parseAmazonUrl` are simplified. Errors,
  warnings and resolved URLs are unchanged.

## 0.3.0

### Minor Changes

- 7d666d9: Raise the supported Node floor from ≥ 20 to ≥ 22 (`engines.node`) — Node 20 reached end-of-life in April 2026. CI now runs on Node 24 (current LTS). No code changes; if you're on Node 22+ already, nothing to do.

## 0.2.1

### Patch Changes

- b695c74: Each package now ships its own README (what it's for, quick-start, zero-dependency footprint, link to the project) and a LICENSE file, so the npm package pages are no longer blank.

## 0.2.0
