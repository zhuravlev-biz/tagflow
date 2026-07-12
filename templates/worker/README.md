# TagFlow standalone Worker template

Localized Amazon affiliate links as a standalone Cloudflare Worker: visitors
hit `/go/<product>` and get a 302 to the right storefront, right ASIN, right
per-marketplace affiliate tag. Runs entirely on the Cloudflare free plan.

## Setup

1. Copy this directory (it is self-contained).
2. Edit `affiliate.config.json` — or regenerate it interactively:

   ```sh
   npx tagflow init --force
   ```

3. Validate and run locally:

   ```sh
   npx tagflow validate
   npx wrangler dev
   curl -i http://localhost:8787/go/example-product
   ```

4. Deploy:

   ```sh
   npx wrangler deploy
   ```

5. (Recommended) Route it under your own domain in `wrangler.jsonc` so the
   click source stays identifiable — see the commented `routes` example.

## Weekly availability checks

`.github/workflows/check-listings.yml` runs `tagflow check` every Monday and
fails when a previously-available listing disappears. Add `PAAPI_ACCESS_KEY`
and `PAAPI_SECRET_KEY` repository secrets (PA-API keys from Associates
Central) to enable it.

## Analytics

The `CLICKS` Analytics Engine binding in `wrangler.jsonc` logs one data point
per click (country, marketplace, product, resolution reason, UA class) — free
plan included, no cookies, no PII. Delete the block to disable logging;
redirects are unaffected.
