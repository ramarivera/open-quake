---
name: truth-mirror
description: Use at session start, before completion claims, before push, and whenever truth-mirror ledger rejections or memory-skill candidates may be unresolved. Run `truth-mirror reinject --agent grok` and treat non-empty output as mandatory work.
---

<!-- truth-mirror managed grok skill -->

# Truth Mirror Unresolved Findings (Grok)

Grok Build does **not** inject `UserPromptSubmit` (or other passive) hook stdout into the model context. Reinjection is active, not hook-stdout:

```bash
truth-mirror reinject --agent grok
```

If the command prints anything, address or waive those findings before claiming completion or pushing. Do not ignore empty success as "all clear" without having run the command in this session when ledger state may have changed.

Optional status:

```bash
truth-mirror ledger list
truth-mirror status
```
