# Host credential boundary

`CredentialVault` requires an explicitly injected `MacOsKeychain` backend.
The typed backend uses service namespace `org.open-quake.ai-provider.v1` and an
opaque UUID account reference. Secrets are `Redacted<string>` and never appear
in provider profiles, browser contracts, error diagnostics, or returned storage
metadata. Tests generate disposable synthetic values at runtime.

`store` creates a new reference with auth generation zero. Replacement always
creates another reference and removes the old one, rather than reusing an
account. `remove` revokes local leases before native deletion; active provider
streams abort even when deletion fails. A pending read cannot restore a removed
credential. Missing values yield `AI.PROVIDER.AUTH_REQUIRED`; removed references
or a stale generation yield `AI.PROVIDER.AUTH_REVOKED`. Backend failures yield
`AI.CREDENTIAL.STORE_FAILED` with private original causes and scrubbed diagnostics.

At the host root, provide `MacOsKeychain`, then `CredentialVault.Default`, then
`AiCredentialsFromVault` and `AiProviderService`. No root hookup is included in
this lane. The native binding and settings/preload consumer remain to be wired
and verified. This interface does not claim actual macOS Keychain access.

There is no default backend or plaintext/session fallback. A failed removal
must be shown to settings so the user can retry secure deletion. Local revocation
survives for this vault's lifetime; durable deletion after a failed native removal
is not established across restart. An explicitly selected session-only store is
separate future composition, never an automatic response to secure-store failure.
