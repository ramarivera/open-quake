## Context

The device catalog and editor key dictionaries support eight locales. Agent feature copy currently falls back to English outside German. Built-in IDs and title keys are compatibility data.

## Decisions

- Retain all identifiers and stored payloads. Update display text only, including template title text.
- Add partial translated agent copy for the six missing locales and merge it with existing English copy. Reuse the resolved copy in bundled translations.
- Recognize the old built-in agent defaults and current catalog translations during display resolution. Preserve other names and custom profile IDs.
- Keep local OpenClaw process setup and lifecycle naming specific. General connection, key and shared strip feedback uses agent naming.

## Verification

Use offline Vitest rendering, dictionary coverage and profile encode/decode checks. Run desktop typecheck and tests, device package tests and root lint. Do not launch Electron, desktop, native acceptance tests or hardware tests. No dependencies or schema changes.
