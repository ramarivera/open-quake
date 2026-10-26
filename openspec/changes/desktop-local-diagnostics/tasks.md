## 1. Safe destination and tracing

- [x] 1.1 Implement bounded private NDJSON logging and native Effect tracing with safe catalog/cause/source projection; verify hostile inputs, retention, failed storage, cancellation and concurrent isolation. Bead open-quake-hbe.3, commits e63e4e4 and 8510f28.
- [x] 1.2 Inject the process-owned diagnostics dependency into every production runtime and bare interpreter boundary; instrument actual IPC and voice work before recovery, verify service acquisition/finalizers and shared correlation. Bead open-quake-q0f.1.
- [x] 1.3 Verify actual desktop runtime interaction and speech/device failure evidence in production composition, inspect retained records and prove shutdown flushing. Physical microphone/hearing acceptance remains separate. Bead open-quake-q0f.2.
- [x] 1.4 Document local retrieval, safe fields, retention limits and export without remote shipping. See apps/desktop/src/main/diagnostics/README.md. Bead open-quake-hbe.3.

Source and automated acceptance are reconciled in verification.md. Reviewed delivery remains tracked by open-quake-q0f.1 and open-quake-q0f.2 until the final integration PR merges. Physical microphone, hearing and physical-trigger acceptance remain with their owning changes.
