# Tasks

Normal chat is implemented by ai-chat-core. This change's first-release work is its availability boundary; all other modes/extensions follow later. Each task maps to a parent-created Beads issue.

## 1. First-release mode boundary

- [ ] 1.1 Record decisions on mode gates, registry policies, attachment limits, report format, and media deadlines; verify `openspec validate ai-chat-modes --strict` and document the phase map.
- [ ] 1.2 Implement mode/import Schemas and normal-only dispatch; verify all known numeric IDs, unknown IDs, immutable accepted modes, and disabled modes causing no capture/upload/provider/action calls through the real chat consumer, and document availability.

## 2. Later profile and host modes, macOS first

- [ ] 2.1 Implement keyConfig candidate validation and profile revision preview/apply; verify unsupported/duplicate keys, invalid actions, stale revision, and no write before confirmation through the profile consumer, and document candidate/apply behavior.
- [ ] 2.2 Register structured PC operations with host integration and agent-runtime; verify disabled shell, malformed proposals, exact argument confirmation, macOS permission denial, and no prose execution through the real executor adapter, and document supported actions.
- [ ] 2.3 Integrate HA entity/service phases with the HA-owning domain; verify removed entities, stale catalogs, invalid services/data, and no mutation before required approval against fixtures and a test instance, and document remaining test-instance gaps.

## 3. Later analysis, media, and extensions

- [ ] 3.1 Implement explicit file/screenshot input and analysis stages/local Markdown save; verify picker cancellation, mime/size/modality rejection, stage order, privacy, and failed atomic saves through the desktop consumer, and document input/export limits.
- [ ] 3.2 Implement capability-checked picture/video jobs and local asset candidates; verify 300s timeout, fragmented responses, unsupported remote cancellation, no generation resubmission, and explicit profile/artwork apply, and document provider evidence per modality.
- [ ] 3.3 Implement emoji generation/edit as candidate revisions; verify text edits, invalid asset metadata, user application, and unchanged icons before apply through the artwork consumer, and document the workflow.
- [ ] 3.4 Add opt-in registry search and explicit selection actions with the host-integration lane; verify source provenance, excluded apps, disabled hooks, and no capture/search side effects in first-release mode, and document enablement and privacy behavior.
- [ ] 3.5 Run enabled-mode acceptance on Linux after macOS; verify explicit unsupported platform gates and action permissions with the real platform adapters, and document per-mode availability without claiming Windows support.
