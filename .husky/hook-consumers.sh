#!/bin/sh
# Shared consumer helpers for hooks that run both Entire and Truth Mirror.
# Topology (migration spec, Ramiro 2026-08-22): Husky is the sole hook owner;
# repository gates run first with immediate exit on error; then Entire and
# Truth Mirror run sequentially with their statuses saved so either can fail
# without preventing the other; the hook rejects if either errored.

run_entire_hook() {
	hook_name=$1
	shift

	if command -v entire >/dev/null 2>&1; then
		if [ "$hook_name" = "pre-push" ]; then
			# Git passes <remote-name> <remote-url>; Entire accepts only the name.
			entire hooks git "$hook_name" "$1"
		else
			entire hooks git "$hook_name" "$@"
		fi
	else
		echo "[$hook_name] entire binary not found - counting as consumer error." >&2
		return 1
	fi
}

# Readiness probe for the Truth Mirror consumer: verifies the vendored binary
# (mise.toml pins cargo:truth-mirror) and the repo-owned state dir. The caller
# keeps the literal `truth-mirror ... hook-dispatch <hook>` line so
# `truth status` recognizes the hook.
ensure_truth_ready() {
	hook_name=$1

	_mise_shims="${MISE_DATA_DIR:-$HOME/.local/share/mise}/shims"
	[ -d "$_mise_shims" ] && PATH="$_mise_shims:$PATH" && export PATH

	if ! command -v truth-mirror >/dev/null 2>&1; then
		echo "[$hook_name] truth-mirror not resolvable - counting as consumer error." >&2
		return 1
	fi
	if [ ! -f ".truth/config.toml" ]; then
		echo "[$hook_name] .truth/config.toml missing - counting as consumer error." >&2
		return 1
	fi
	unset TRUTH_MIRROR_STATE_DIR
	return 0
}

finish_shared_hook_consumers() {
	hook_name=$1
	entire_status=$2
	truth_status=$3

	if [ "$entire_status" -ne 0 ]; then
		echo "[$hook_name] Entire exited with status $entire_status." >&2
	fi
	if [ "$truth_status" -ne 0 ]; then
		echo "[$hook_name] Truth Mirror exited with status $truth_status." >&2
	fi

	if [ "$entire_status" -ne 0 ] || [ "$truth_status" -ne 0 ]; then
		return 1
	fi
	return 0
}
