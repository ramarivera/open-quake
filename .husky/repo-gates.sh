#!/bin/sh
# Repository gates - sourced by pre-push. Each gate must exit 0 or the push is
# rejected IMMEDIATELY (fail fast, per the migration topology law).

echo "[gates] biome lint..."
pnpm run lint || exit 1
