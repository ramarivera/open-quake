# Disposable agent runtime E2E

These opt-in tests start real pinned Hermes and OpenClaw containers and call the
production adapters and HTTP transport. They check authenticated discovery,
streamed model replies and two-turn session continuity. OpenClaw's Responses and
chat-completions protocols run separately. Ordinary `pnpm test` skips live calls.

You'll need Docker Compose, Git, the workspace dependencies, and an external
scratch directory with space for the Hermes source and Docker build. Image builds
can take several minutes. The provider must accept OpenAI-compatible chat
completions. Each successful run makes six model requests, without tools. Provider
charges depend on your endpoint. The runner doesn't retry conversation requests.

Set these environment variables before running:

| Variable | Purpose |
| --- | --- |
| `OPEN_QUAKE_E2E_BASE_URL` | OpenAI-compatible provider base URL, including its API prefix |
| `OPEN_QUAKE_E2E_API_KEY` | Optional provider API key, passed through to both runtime configurations |
| `OPEN_QUAKE_E2E_MODEL` | Explicit provider model ID. There's no model default or fallback |
| `OPEN_QUAKE_E2E_SCRATCH` | Absolute scratch directory outside the checkout |

Use your shell or secret manager to supply the key. Don't put it in command
arguments, checked-in files or a PR comment. Endpoints without authentication use
the runtimes' `no-key-required` placeholder when the key variable is absent.

The provider address must be reachable from inside both containers. Host loopback
addresses such as `localhost` and `127.0.0.1` are rejected because they refer to
each container itself. For a provider on the Docker host, use a reachable host
address or `host.docker.internal` if your Docker installation supports it. The
provider must listen on that interface; the runner doesn't rebind your service.

From Nushell, after setting the variables:

```nu
pnpm --filter @open-quake/edge test:e2e:config
pnpm --filter @open-quake/edge test:e2e
```

The runner creates a unique Compose project and random bearer token. API ports
publish only on loopback. Runtime state lives in container tmpfs. Neither runtime
mounts your home directory, credentials, repository or Docker socket. The only
runtime mounts are these read-only bootstrap scripts. Credentials are supplied
through the environment and temporary container config; don't inspect or publish
container environment dumps while a test is running.

Hermes uses source commit `e10934b03e115b036b3c38b9c6e6817039a5962d`, a frozen
dependency lock and a pinned Python/uv image. OpenClaw uses version 2026.10.7 with
an immutable image digest. All toolsets/plugins and messaging integrations are
disabled. No agent lifecycle action touches an existing installation.

The runner tears down its project on success or failure and verifies no labeled
containers, networks or volumes remain. Its source checkout is deleted only after
successful cleanup. Docker's image and build caches remain reusable.
`OPEN_QUAKE_E2E_FORCE_FAILURE=1` forces a failure
after readiness without running inference, to exercise teardown. Failures write
exit-status diagnostics under your scratch directory. Arbitrary process output
and runtime logs aren't saved or printed because provider errors may contain
encoded credentials. SIGKILL or a host crash can't run cleanup. On cleanup
failure, the runner preserves and reports its scratch state directory, including
a credential-free recovery Compose file. Remove only that project with
`docker compose --file <state>/cleanup.compose.json down --volumes --remove-orphans`.
This recovery file needs no provider settings or original bearer token. Recheck
project-labeled resources before deleting the retained state directory.

This proves runtime HTTP behavior. It doesn't prove Electron UI interaction,
microphone input, STT, TTS, physical QUAKE input or audible output.
