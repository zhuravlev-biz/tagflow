---
"@tagflow/cli": patch
---

`tagflow check --write` sorts `availableIn` with an explicit code-unit
comparator instead of a bare `.sort()`. The written order is unchanged.
