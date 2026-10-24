# Feature inventory erratum

This entry supersedes the "first exchange summarized" claim in the local-only `.context/research/dk-suite-feature-inventory.md`, section 4. The worktree copy has this replacement; the lead can carry it to the original research file without committing the archive.

Replace the chat-title row with:

> - [ ] **Chat title auto-resolution** (S, `AI-236`): first user message, unchanged when at most 10 characters; otherwise the first 10 characters plus `...`. Ref: `v0.4.95/recovered_sources/src/views/AIAssistant/AIAssistantContent.vue:885-897`. DK-Suite overwrites manual renames on every send; open-quake preserves them.

The aiChatTitleResolve helper localizes preset labels; it does not summarize the first exchange. `ai-chat-core/specs/ai-chat-core/spec.md` now contains the precise fallback rule and boundary scenarios. Optional model-generated titles remain a later extension.
