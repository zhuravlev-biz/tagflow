# Astro + static assets example (mounted mode)

The primary deployment shape: your Astro site is already served by a
Cloudflare Worker with static assets, and the affiliate router mounts inside
that same Worker. No second zone, domain, or deployment.

How it fits together:

- `astro build` emits the static site to `dist/`.
- `wrangler.jsonc` binds `dist/` as `ASSETS` and points `main` at
  [worker/index.ts](worker/index.ts).
- The Worker tries the affiliate handler first; `null` (non-`/go` paths and
  unknown product keys) falls through to `env.ASSETS.fetch(request)` — the
  site, including its 404 page, behaves exactly as before.
- Templates build links with `goUrl('flagship-product')` from `@tagflow/core`
  ([src/pages/index.astro](src/pages/index.astro)).

```sh
pnpm install
pnpm preview          # astro build + wrangler dev
curl -i http://localhost:8787/          # the Astro site
curl -i http://localhost:8787/go/flagship-product   # 302 to Amazon
curl -i http://localhost:8787/go/nope   # the site's 404, not the router's
pnpm deploy           # astro build + wrangler deploy
```

Remember a `robots.txt` under `public/` disallowing the mount prefix (see
[public/robots.txt](public/robots.txt)) and `rel="sponsored nofollow"` on the
links themselves.
