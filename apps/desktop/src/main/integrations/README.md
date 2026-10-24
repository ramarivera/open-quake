# Management integrations

Implements management-center-parity tasks 5.1–5.6, CENTER-072–079 and
CENTER-092–102. The renderer pages use `window.quakeIntegrations`; no page
has an in-memory production backend or writes renderer localStorage.

The parent owns shared registration. These are the exact integration points:

```ts
// Main, after the shared profiles runtime exists.
const integrations = registerIntegrations({
  management: () => managementWindow,
  rendererURL,
  profileRuntime: profiles.runtime,
  // Optional real adapters. Omit them when unavailable.
  channelRuntime,
  draftShortcuts,
});
// Main shutdown, before disposing profiles.runtime.
await integrations.dispose();

// Production preload entry, one side-effect import.
import "../main/integrations/preload";

// Renderer management pages.
import { ChannelsPage, ShortcutsPage, HomeAssistantPage } from
  "./management/integrations";
// Agents Settings: <ChannelsPage />
// Shortcuts route: <ShortcutsPage />
// Apps / Home Assistant: <HomeAssistantPage />

// Strip renderer registry.
import { HomeAssistantTile } from
  "./tiles/home-assistant/HomeAssistantTile";
// Add ["homeAssistant", HomeAssistantTile] to stripTileRegistry.
```

`registerIntegrations` accepts optional `ChannelRuntime` and shortcut drafting
ports. The default channel adapter reports OpenClaw unavailable and performs no
installation. Manual shortcut rows, libraries and profile sync remain available
when `draftShortcuts` is absent. Supplying `draftShortcuts(request)` makes the
request exactly `<app>：<prompt>`; its returned text is JSON/Schema decoded.
Only one-action hotkey entries become rows. Shell/app/multi-action entries are
counted and dropped. Win serializes to `meta` in libraries and translates to
`super` at the existing keyboard contract boundary.

Home Assistant is a real HTTP(S) REST adapter. `/api/`, `/api/states`,
`/api/services`, `/api/template`, individual entity state reads and service POSTs
are bound to one owned session. The template asks HA for `area_name` metadata.
Only the active profiles' visible non-icon HA entities are polled, every
`HA_POLL_INTERVAL_MS` = 2000 ms. Profile changes replace that set; stale poll
results from a previous set are discarded. Disconnection clears live states.
The exported `useHaLive` subscribes through production preload and releases its
listener on unmount. Icon mode uses the existing GenericTile renderer.

The shared `management/profile-contracts.ts` registry is the canonical validator
for persisted `homeAssistant` keys. The parent has injected it into the profiles
root. This module does not add a competing action registration. HA actions store
one `configData` JSON string, as recovered from background.js. Parent dispatch
can decode a committed key using `keyHaConfig(key)` from `./profiles`, then call
`await integrations.executeHaFromKey(config)` for an explicitly configured direct key.
This trusted main-only capability must never be registered as an AI tool. Accepted AI actions use
`await integrations.executeHa(config)`, always enforcing the saved entity
allowlist. `await integrations.aiEntities()` is the typed AI discovery query.
Both calls use the same entity, service and field validation path.

Stores live under `<userData>/integrations-v1/`. Versioned JSON files contain
credential references, never raw tokens. `systemCredentialVault(root)` stores
OS-encrypted safeStorage bytes under random references. It refuses unavailable
OS encryption and Linux basic_text. HA status exposes only its token suffix.
The HTTPS Agent releases a socket only after normal TLS verification or explicit
consent matching that origin and certificate's SHA-256 fingerprint. It changes
no app or provider TLS setting. Redirects are refused. Reconnect never replays a
service request.

QR sessions have independent IDs, pending/ready/confirmed/expired/cancelled/failed
states and an Effect-scoped five-minute expiry. The drawer cancels on close,
replacement ignores late progress, and only adapter confirmation permits Finish.
Pairing requires an explicit approval; simultaneous clicks send one approval.
A credential deletion failure retains the configuration reference for retry.

Shortcut libraries sync transactionally through the existing profile repository,
using 16 keys per page in row-major order. Re-sync updates the same profile ID.
The existing 30-profile capacity and ten-character weighted naming rule apply.
Rename a long library before sync; a rejected name or failed write changes no
profile. No key is executed while decoding, editing, saving or syncing a library.

## Source evidence

Read from `/Users/ramarivera/dev/dark-encyclopedia/dk-suite-introspeccion/v0.4.95/`:

- `audit/AUDIT_CENTER.md`, rows 072–079 and 092–102, and `audit/GAP-MAP.md`.
- `app-resources/background.js`: recovered six-channel catalog, setup validation,
  channel login/pairing, `_handleGenKeyConfigLibResponse`, HA configData descriptor
  and live monitor rendering. The minified byte offsets differ from audit hints.
- `recovered_sources/src/views/ManagementCenter/components/channels/` Vue files.
- `recovered_sources/src/views/ManagementCenter/ShortcutFlowStudio.vue` and
  `AIPluginManager.vue`.
- `recovered_sources/src/views/Components/HomeAssistantConfig.vue`,
  `OperationConfiguration.vue`, and `views/CustomConfig/HAConfigContent.vue`.
- `locales/locale-en.json`. Strings are retained verbatim in renderer `strings.ts`.

The locale's five sample app labels differ from the old Vue identifier names.
The implementation targets the displayed Photoshop, Illustrator, Figma,
Premiere Pro and Office apps, following the parity spec. No OpenSpec edits were
made in this implementation task.

## Verification

```sh
pnpm --filter @open-quake/edge typecheck
pnpm --filter @open-quake/desktop typecheck
pnpm --filter @open-quake/edge exec vitest run src/channels/channel-service.test.ts
pnpm --filter @open-quake/desktop exec vitest run src/main/integrations
```

The desktop tests exercise production preload → decoded controller → real
conductors with fake runtime/vault/profile ports, plus real loopback HTTP/TLS
servers and the shared ProfileService repository. Tests cover certificate
replacement and origin isolation, and verify no HTTP request reaches an
untrusted TLS server before consent. The TestClock test proves autonomous QR
expiry without renderer polling. TLS test certificates are generated under the
lane scratch directory and removed afterward.

Full native page screenshots and broad repository gates are coordinated by the
parent with `OPEN_QUAKE_MOCK_DEVICE=1`. No real channel account, external HA
installation, hardware, or DK-Suite instance was accessed by this implementer.
