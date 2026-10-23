# Tasks

These are future implementation tasks. This lane creates specs only; no checkbox is complete. The parent creates one epic for this change and one issue per numbered task, using each task's text as its description and this OpenSpec path as its reference. Do not close implementation issues on planning-only evidence.

## 1. Capture and storage contracts

- [ ] 1.1 Confirm source/retention/retry proposals and question 11 deferral, and trace inventory DOCX evidence; verify a written stage/capture/export contract without enabling liveAudioTranslate.
- [ ] 1.2 Add meeting/chunk/stage schemas, lifecycle invariants and repository documentation; verify duplicate-stop idempotence, generation IDs and interrupted-stage recovery.

## 2. Capture and processing

- [ ] 2.1 Implement desktop microphone/system-audio adapters and capture conductor with catalog errors; verify permission failure, optional-source choice, source loss and track cleanup through fake media streams.
- [ ] 2.2 Implement ordered finalization, transcript persistence, generation and stage-only retry through existing speech/AI facades; verify generation failure retains transcript, cancellation calls no provider and diagnostics omit content.
- [ ] 2.3 Implement local history read/delete and DOCX export adapters with user documentation; verify partial deletion failures and independently read the exported document's title/text/escaping.

## 3. Recorder and history acceptance

- [ ] 3.1 Wire recording state/animations, history, transcript/minutes, retry/delete/export through the typed client; verify actual controls produce the expected stage/provider/file operations.
- [ ] 3.2 Run all meeting-minutes scenarios, including restart/cancel/source loss; document native audio/provider/device-trigger evidence separately and leave missing hardware/OS validation open.
