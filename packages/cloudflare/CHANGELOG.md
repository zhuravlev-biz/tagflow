# @tagflow/cloudflare

## 0.4.0

### Patch Changes

- 021467d: Trim leading/trailing slashes in `goUrl`/`goAmazonUrl` and the handler's
  route prefix with a linear scan instead of a backtracking regex. Output is
  unchanged.
- 437b377: Internal cleanup of the click logger and HTML escaping; logged data points
  and rendered choice pages are unchanged.
- Updated dependencies [593f2d7]
- Updated dependencies [021467d]
- Updated dependencies [0288f58]
  - @tagflow/core@0.4.0

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

### Patch Changes

- @tagflow/core@0.2.0
