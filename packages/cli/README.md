# @tagflow/cli

CLI for [TagFlow](https://github.com/zhuravlev-biz/tagflow) — scaffold,
validate, and availability-check the config behind your localized Amazon
affiliate links.

**Zero third-party dependencies** — the only dependency is
[`@tagflow/core`](https://www.npmjs.com/package/@tagflow/core), which itself
has none at all. Just Node ≥ 22.

## Commands

```sh
npx tagflow init             # scaffold affiliate.config.json interactively
npx tagflow validate         # schema + invariants; non-zero exit for CI
npx tagflow check            # verify every product × marketplace listing exists
npx tagflow stats            # click stats from Workers Analytics Engine
npx tagflow import-earnings  # join an Associates earnings report against clicks
```

## The revenue-leak monitor

`tagflow check` is the thing paid link-localizer services charge for: for
every product × tagged marketplace it verifies the Amazon listing actually
exists, updates `availableIn` with `--write`, and **exits non-zero when a
previously-available listing died** — i.e. when clicks would silently start
leaking to fallbacks. Run it weekly in CI (the
[worker template](https://github.com/zhuravlev-biz/tagflow/tree/main/templates/worker)
ships a ready-made GitHub Action).

Two engines:

- `--engine creatorsapi` — Amazon's Creators API (PA-API's successor).
  Reads `CREATORSAPI_CREDENTIAL_ID` / `CREATORSAPI_CREDENTIAL_SECRET` env
  vars (create credentials under Associates Central → Tools → Creators API).
  Auto-selected when both are set; the only engine suitable for CI.
- `--engine probe` — rate-limited HTTPS probe of the public product page,
  from your own machine and IP at your own discretion, never from
  CI/datacenter infrastructure. Sends no affiliate tag. The default when no
  credentials are set.

`tagflow stats` reads the Worker's optional Analytics Engine click log
(clicks by marketplace × resolution reason, top products, and a
`--leaks` report of clicks that fell back past their geo marketplace).

## Documentation

Full docs, config reference, Worker quickstart and compliance notes:
**[github.com/zhuravlev-biz/tagflow](https://github.com/zhuravlev-biz/tagflow)**

MIT. Unaffiliated with Amazon and Cloudflare.
