# @tagflow/cli

## 0.3.0

### Minor Changes

- 7d666d9: Raise the supported Node floor from ≥ 20 to ≥ 22 (`engines.node`) — Node 20 reached end-of-life in April 2026. CI now runs on Node 24 (current LTS). No code changes; if you're on Node 22+ already, nothing to do.

### Patch Changes

- Updated dependencies [7d666d9]
  - @tagflow/core@0.3.0

## 0.2.1

### Patch Changes

- b695c74: Each package now ships its own README (what it's for, quick-start, zero-dependency footprint, link to the project) and a LICENSE file, so the npm package pages are no longer blank.
- Updated dependencies [b695c74]
  - @tagflow/core@0.2.1

## 0.2.0

### Minor Changes

- d03b3a4: `check` now verifies listings via the Creators API instead of the retired PA-API (Amazon shut off PA-API on 2026-05-15). `--engine paapi` is removed; `--engine creatorsapi` is the replacement, auto-selected when `CREATORSAPI_CREDENTIAL_ID`/`CREATORSAPI_CREDENTIAL_SECRET` env vars are set (replacing `PAAPI_ACCESS_KEY`/`PAAPI_SECRET_KEY`). Passing the old `--engine paapi` now fails with a message pointing at the replacement instead of a generic "unknown engine" error. The HTTPS probe engine (`--engine probe`) is unchanged.

### Patch Changes

- @tagflow/core@0.2.0
