# Tasks

These are future implementation tasks. This lane creates specs only; no checkbox is complete. The parent creates one epic for this change and one issue per numbered task, using each task's text as its description and this OpenSpec path as its reference. Do not close implementation issues on planning-only evidence.

## 1. Capture and storage contracts

- [ ] 1.1 Confirm source/retention/retry contracts and the shipped live translation route (`AI-136/292/327`), and trace `.md`/`.txt` export evidence (`AI-315`); verify stage/capture/export contracts and bounded translation display history.
- [ ] 1.2 Add meeting/chunk/stage schemas, lifecycle invariants and repository documentation; verify duplicate-stop idempotence, generation IDs and interrupted-stage recovery.

## 2. Capture and processing

- [ ] 2.1 Implement desktop microphone/system-audio adapters and capture conductor with catalog errors; verify permission failure, optional-source choice, source loss and track cleanup through fake media streams.
- [ ] 2.2 Implement ordered finalization, transcript persistence, generation and stage-only retry through existing speech/AI facades; verify generation failure retains transcript, cancellation calls no provider and diagnostics omit content.
- [ ] 2.3 Implement local history read/delete and UTF-8 Markdown summary/plain-text transcript export adapters (`AI-315`) with user documentation; verify filename sanitation, partial deletion failures and independently compare exported text with saved content.

## 3. Recorder and history acceptance

- [ ] 3.1 Wire recording state/animations, history, transcript/minutes, retry/delete/export and the live translation toggle through the typed client (`AI-136/292/327`); verify actual controls produce the expected stage/provider/file operations.
- [ ] 3.2 Run all meeting-minutes scenarios, including restart/cancel/source loss; document native audio/provider/device-trigger evidence separately and leave missing hardware/OS validation open.
