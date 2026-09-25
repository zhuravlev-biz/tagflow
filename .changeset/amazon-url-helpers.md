---
"@tagflow/core": minor
---

Add `parseAmazonUrl` and `withAffiliateTag`, two pure, dependency-free URL
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
