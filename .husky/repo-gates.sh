#!/bin/sh
# Repository gates - sourced by pre-push. Each gate must exit 0 or the push is
# rejected IMMEDIATELY (fail fast, per the migration topology law).

echo "[gates] biome lint..."
# A checkout without dependencies makes pnpm exit 254 ("biome: command not
# found"); output filters such as rtk mislabel that as an OOM. Name it plainly.
if [ ! -x node_modules/.bin/biome ]; then
	echo "[gates] node_modules/.bin/biome missing - run 'pnpm install' first." >&2
	exit 1
fi
pnpm run lint || exit 1
