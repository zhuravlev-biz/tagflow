# @tagflow/cloudflare

Cloudflare Worker adapter for [TagFlow](https://github.com/zhuravlev-biz/tagflow) —
localized Amazon affiliate links on your own domain, $0/mo on the Cloudflare
free tier. A free, self-hosted alternative to Amazon OneLink and Geniuslink.

**Zero third-party dependencies** — the only dependency is
[`@tagflow/core`](https://www.npmjs.com/package/@tagflow/core), which itself
has none at all.

## What it does

A visitor clicks `yoursite.com/go/flagship-product`. The Worker reads the
country Cloudflare already resolved (`request.cf.country`), picks the right
Amazon storefront, the right ASIN for that storefront, and the affiliate tag
you configured for that marketplace — then 302s:

```
DE visitor → /go/flagship-product → 302 https://www.amazon.de/dp/B0YYYYYYYY?tag=yourtag0d-21
US visitor → /go/flagship-product → 302 https://www.amazon.com/dp/B0XXXXXXXX?tag=yourtag-20
?? visitor → /go/flagship-product → 302 to your default marketplace, always tagged
```

Explicit, configured fallbacks instead of OneLink's opaque "similar product"
matching or search-page dumps. Sub-millisecond resolution — one map-lookup
chain, no I/O. No cookies, no PII.

## Usage

**Standalone Worker** — one `export default`, deploy and done (or start from
the [ready-made template](https://github.com/zhuravlev-biz/tagflow/tree/main/templates/worker)):

```ts
import config from './affiliate.config.json'
import { createAffiliateWorker } from '@tagflow/cloudflare'

export default createAffiliateWorker(config)
```

**Mounted inside your existing Worker** (Astro, Next, any static site already
served by a Worker) — the handler returns `null` for paths it doesn't own, so
everything else falls through to your site:

```ts
import config from './affiliate.config.json'
import { createAffiliateHandler } from '@tagflow/cloudflare'

const affiliate = createAffiliateHandler(config) // owns /go/* by default

export default {
  async fetch(request, env, ctx) {
    return (await affiliate(request, env, ctx)) ?? env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
```

Also included: optional per-click logging to Workers Analytics Engine
(country × marketplace × product × resolution reason — aggregate-only, logged
after the redirect via `waitUntil`), A/B link variants, multi-retailer choice
pages, and mobile deep-link routing.

## Documentation

Full docs, config reference, templates, examples, and compliance notes:
**[github.com/zhuravlev-biz/tagflow](https://github.com/zhuravlev-biz/tagflow)**

MIT. Unaffiliated with Amazon and Cloudflare.
