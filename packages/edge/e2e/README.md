# Disposable agent runtime E2E

These opt-in tests start pinned real Hermes and OpenClaw containers and call the
production adapters and HTTP transport. They check authenticated discovery,
streamed replies and two-turn session continuity. OpenClaw Responses and chat
completions run separately. Ordinary tests don't make live calls.

You'll need Docker Compose, Git, the workspace dependencies, Electron's native
credential store, and an external scratch directory with room for the Hermes
source and build. The provider must support chat completions and be reachable
from inside the containers. Host loopback addresses are refused.

## Select a saved production model

Configure the model in Agents > AI configuration first. The runner requires the
app data directory, saved model row id, exact scope and explicitly authorized
model. It reads that row through production agent storage and resolves its
existing credential using the production native vault. It never edits the source
app settings or reads a different row as fallback. An absent or mismatched model,
missing credential or unavailable native store fails before container startup.

The old `OPEN_QUAKE_E2E_BASE_URL`, `OPEN_QUAKE_E2E_API_KEY` and
`OPEN_QUAKE_E2E_MODEL` inputs are rejected, including when present but empty.
Provider URLs and keys aren't command arguments. There are no endpoint or model
defaults. For this project's authorized acceptance, select `gpt-6.1-sol`.

From Nushell, substitute the source app's absolute data path and saved row id:

```nu
$env.OPEN_QUAKE_E2E_SCRATCH = "/absolute/external/scratch"
$env.OPEN_QUAKE_E2E_DESKTOP = "1"
pnpm --filter @open-quake/edge test:e2e:config
node packages/edge/e2e/run.mjs --user-data "/absolute/app-data" --scope default --model-row "saved-row-id" --authorize-model "gpt-6.1-sol"
```

The model selection is a deliberate inference opt-in. Adapter acceptance makes
six model requests, and desktop acceptance adds four. Provider charges depend
on the saved profile. Conversation requests aren't retried. Tools, plugins,
browsers and messaging integrations are disabled.

## Isolation and credentials

The native reader runs without windows, HID or inference, with its own temporary
session data. It writes one selected provider snapshot into a private 0700
scratch directory. The file starts at 0600, then becomes 0444 inside that private
directory so the container user can read its Compose secret mount. Both
containers mount only that file and their fixed bootstrap script, read-only.
They never mount the source app data, native credential vault, home directory,
repository or Docker socket. Runtime state and any runtime-local credentials
stay in tmpfs. The provider key isn't passed in Compose environment variables.
Hermes copies it to a process-local key variable because its custom-provider
adapter requires `key_env`. Don't publish container dumps or process environments.

The runner creates a random project name and runtime bearer. Runtime API ports
publish only on loopback. Hermes is pinned to source commit
`e10934b03e115b036b3c38b9c6e6817039a5962d`, with a frozen dependency lock and
pinned Python/uv image. OpenClaw 2026.10.7 uses an immutable image digest. No
lifecycle action touches an existing runtime installation.

## Cleanup and failures

Success, failure and handled interruption tear down the owned Compose project,
then verify no labeled containers, networks or volumes remain. The source
checkout is deleted only after successful cleanup. Docker build caches remain.
The private provider snapshot is deleted even if Docker cleanup fails. Failed
cleanup preserves a credential-free `cleanup.compose.json` recovery file under
the reported state directory. Use only that project's recovery file to remove
remaining resources, then verify their absence before deleting recovery state.
SIGKILL or a host crash can't run finalizers and can leave the private snapshot;
remove only that owned state after checking the project resources.

`OPEN_QUAKE_E2E_FORCE_FAILURE=1` stops after authenticated readiness, before
inference, to verify cleanup. Exit diagnostics omit arbitrary subprocess output,
provider messages, URLs and credentials. Adapter checkpoints record only stage
and synthetic acceptance metadata. No provider response bodies or runtime logs
are retained by the runner.

## Production desktop acceptance

With `OPEN_QUAKE_E2E_DESKTOP=1`, the runner builds the actual app root and preload,
starts them with isolated user data and mandatory mock hardware, then drives the
real connection and conversation controls. All windows stay invisible,
nonfocusable and click-through. It checks selected runtime identity, two replies,
remote continuity, local history and normal production shutdown. At real content
sizes of 1180 and 390 wide, it checks composer visibility and horizontal overflow,
and captures synthetic conversations beneath `desktop-e2e-*` in scratch.

The desktop uses the native vault for its disposable runtime bearer and fails
if it can't encrypt it. Neither mode proves microphone input, speech-provider
compatibility, physical QUAKE input or audible playback.
