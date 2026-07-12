# Standalone example

The smallest possible deployment: `createAffiliateWorker(config)` *is* the
Worker. A multi-marketplace config demonstrates country overrides
(`CH → de`), fallbacks (`fr/it → es`, `co.uk → de`) and a per-marketplace
ASIN override.

```sh
pnpm install
pnpm dev
curl -i http://localhost:8787/go/flagship-product
curl -i http://localhost:8787/go/amazon/B0XXXXXXXX
```

`wrangler dev` has no `request.cf`, so local requests resolve as
`unknown-country` to the default marketplace — deploy to see real geo
routing.
