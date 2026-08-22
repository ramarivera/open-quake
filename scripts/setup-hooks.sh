#!/bin/sh
# Restore the Husky-sole-owner hook topology after Entire touches entries.
#
# `entire enable` (and its self-heal) wraps .husky/_/<hook> entry shims with
# Entire forwarders and saves husky's originals as <hook>.pre-entire. In that
# state husky's h dispatcher derives a "<hook>.pre-entire" hook name, silently
# skips the real content hooks in .husky/<hook>, and truth-mirror's validator
# reports the gates missing (the onyxio "foundry finding"). The committed
# topology runs BOTH consumers from inside the content hooks instead, so the
# entries must stay bare husky shims.
#
# Idempotent: safe to rerun any time, especially after `entire enable --force`.
# Usage: scripts/setup-hooks.sh

set -eu

cd "$(git rev-parse --show-toplevel)"

if [ "$(git config --get core.hooksPath)" != ".husky/_" ]; then
	git config core.hooksPath .husky/_
	echo "core.hooksPath -> .husky/_"
fi

# `bd init` migrates the active hook directory into .beads/hooks and repoints
# core.hooksPath there (review finding on df4ece5 era). Beads is wired as a
# consumer inside the content hooks instead - remove its takeover dir.
if [ -d ".beads/hooks" ]; then
	rm -rf .beads/hooks
	echo "removed beads hooks takeover (.beads/hooks)"
fi

for f in .husky/_/*; do
	name="$(basename "$f")"
	case "$name" in
	*.pre-entire)
		rm -f "$f"
		echo "removed $f"
		;;
	h|husky.sh|.gitignore) ;;
	*)
		expected='#!/usr/bin/env sh'
		if [ -f "$f" ] && [ "$(head -n 1 "$f")" = "$expected" ] && ! grep -q 'Entire CLI hooks' "$f"; then
			continue
		fi
		printf '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n' >"$f"
		chmod +x "$f"
		echo "restored bare shim: $f"
		;;
	esac
done

echo "hook topology restored."
