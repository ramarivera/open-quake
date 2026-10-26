# Offline language support

`AppLocaleProvider` wraps the mounted desktop application. `useAppLocale()` exposes
`locale`, `setLocale`, loading and safe failure state. `useAppTranslations(scope)`
is the installed General Translation dictionary hook. Keep source and translated
strings in bundled JSON. The default provider bundles the Opus-owned `chat`, `agentHttp` and `agents`
namespaces. Tests can supply replacement dictionaries through its `bundled` prop. Generated answers, user messages, model identifiers and
provider selections are data and must never become translation inputs.

The exact MIT runtime dependency is `gt-react@11.4.16`. Its source was checked for
client rendering, dictionary fallback and locale updates. No CLI or cloud account
is required. The configuration disables development hot translation requests,
sets `runtimeUrl` to null and uses local loaders. The provider overrides GT's
normal reload behavior with the saved main-process choice.

`SettingsService` owns the saved language in `settings-v1.json` under userData.
It seeds zh/en/es/fr/ko/de/it/ja once from the OS primary subtag, uses English
for unsupported values, serializes validated changes, preserves unrelated
fields and publishes only locale/revision projections. Unknown versions and
corrupt files fail without automatic overwrite. Atomic private-file replacement
finishes before the new locale becomes visible. A failed write keeps the previous
locale. This repository is the general settings owner, not a second renderer
preference store.

Preload uses the encoded Effect RPC client derived from `SettingsRpcs`.
The main registration accepts only owned current main frames at the app renderer,
validates each method before dispatch, bounds concurrent requests and drops replies
when the requesting document changes. Committed snapshots broadcast to both owned
app windows. Renderer revisions prevent a delayed initial read from reverting a
newer event. Changing locale updates the mounted provider and HTML language without
reloading the page or replacing chat state.

Focused tests cover OS fallback, saved-choice preservation, future fields, failed
writes and private causes, actual encoded RPC/preload round trips, authenticated
main registration, restart/corruption, and GT's translated/source-fallback output
without fetch. The opt-in `direct-chat-smoke.ts` also runs the actual production
root, preload and React app with a mock device and local inference fixture.

The Opus-led redesign owns product copy and control placement. Agent components
read the current locale through copy hooks. Non-React conversation controllers
read a current-copy getter so a language change does not replace subscriptions
or cancel a reply. The actual direct-chat smoke checks the German Stop label
while a provider socket remains open, then switches back and cancels normally.
General settings, onboarding and physical speech acceptance remain separate tasks.


The locale lane bundles recovered picker, native menu and translation-language
copy verbatim for all eight locales. Existing English/German product namespaces
keep their conventions. Other product-specific untranslated namespaces fall back
to English. Clock/enrichment copy uses the saved locale through `useLocaleText`,
including independent profile captures which have no GT provider. App language
never changes spoken language, translation targets, weather locale routing or
user-authored titles. The eighteen translation codes are independent of adapter
availability.

Native lifecycle prompts read the current saved locale at action time. On macOS,
the Dock background menu refreshes on locale changes and retains working Resume,
Settings and Exit actions. Main and both renderers share the same committed
locale/revision owner.

The versioned bootstrap removes only the documented legacy transient keys,
adds missing startup/global wake preferences and preserves durable extensions.
Only explicitly geo-seeded, non-user-chosen China QWen defaults migrate to
DeepSeek. Regional chat/speech/model suggestions are local advisory copy in setup,
never automatic profile selection, credentials, network lookups or hotkey
registration. Invalid/future settings remain untouched.
