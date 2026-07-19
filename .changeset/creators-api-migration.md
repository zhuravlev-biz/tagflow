---
"@tagflow/cli": minor
---

`check` now verifies listings via the Creators API instead of the retired PA-API (Amazon shut off PA-API on 2026-05-15). `--engine paapi` is removed; `--engine creatorsapi` is the replacement, auto-selected when `CREATORSAPI_CREDENTIAL_ID`/`CREATORSAPI_CREDENTIAL_SECRET` env vars are set (replacing `PAAPI_ACCESS_KEY`/`PAAPI_SECRET_KEY`). Passing the old `--engine paapi` now fails with a message pointing at the replacement instead of a generic "unknown engine" error. The HTTPS probe engine (`--engine probe`) is unchanged.
