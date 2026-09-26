---
"@tagflow/core": patch
---

Internal cleanup: `parseConfig` is split into per-section validators and a
few conditionals in `resolve` and `parseAmazonUrl` are simplified. Errors,
warnings and resolved URLs are unchanged.
