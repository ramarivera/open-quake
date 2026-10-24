# Why

Cluster 14 needs the corrected speech protocols, model roles, provider controls and the approved Auto key mode. The existing facade has injected chat transport and mock defaults but no speech driver. Evidence: AI-008, AI-030–033, AI-094, AI-101, AI-105, AI-114, decision lih.22 and decision 12.

# What Changes

- Add independent fetch TTS and injected DashScope WebSocket STT under the facade, with safe errors, workspace endpoints, cancellation, deadlines and owned playback.
- Add profile model roles and validated thinking/search provider options with an explicit quirk table.
- Add Schema-decoded Auto routing alongside explicit key modes and session follow-ups, using recovered categories plus agents, shortcuts and meetings.
- Ship retained recovered role presets and their eight translated names, excluding NSFW and jailbreak roles.

# Capabilities

## New Capabilities

- `ai-providers-parity`: provider workflow and speech route implementation contracts.

## Modified Capabilities

- `voice-stt-tts`: implement independent OpenAI TTS task 2.6, retaining hardware acceptance separately.
- `ai-provider-facade`: additive profile role/control contracts and independent speech facade methods.

# Impact

Owners: packages/edge/src/ai and existing browser-safe contracts. No dependencies, paid calls, hardware, account proxies or SDK substitution. Existing SDK integration tasks remain open. Host recorder/player bindings and integrations belong to their owning lanes and use small injected ports.
