# Spec Delta

## Purpose
Contract for the repository harness: what `pnpm run lint` covers and how the
Truth Mirror consumer can be switched off without unwiring the hook chain.

## ADDED Requirements

### Requirement: Lint excludes build output
`pnpm run lint` SHALL check source under `packages/` and `apps/` and SHALL
NOT scan build output (`out`, `dist`, `.turbo`) or gitignored paths.

#### Scenario: Electron-vite output present
- **WHEN** `apps/desktop/out/` exists after `pnpm run build`
- **THEN** `pnpm run lint` exits 0 and reports only source files

#### Scenario: any ban still enforced
- **WHEN** a source file under `packages/` contains `: any`
- **THEN** `pnpm run lint` fails with `lint/suspicious/noExplicitAny`

### Requirement: Truth Mirror off-switch
The commit-msg, pre-push and post-commit hooks SHALL skip the Truth Mirror
consumer when `.truth/config.toml` sets `enabled = false`, and SHALL still
fail closed when `.truth/config.toml` is missing.

#### Scenario: Disabled
- **WHEN** `enabled = false` and Truth Mirror would reject
- **THEN** the hook does not invoke `truth-mirror` and does not reject on its account

#### Scenario: Config missing
- **WHEN** `.truth/config.toml` does not exist
- **THEN** the hook rejects the operation
