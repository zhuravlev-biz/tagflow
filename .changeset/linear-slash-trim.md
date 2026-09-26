---
"@tagflow/core": patch
"@tagflow/cloudflare": patch
---

Trim leading/trailing slashes in `goUrl`/`goAmazonUrl` and the handler's
route prefix with a linear scan instead of a backtracking regex. Output is
unchanged.
