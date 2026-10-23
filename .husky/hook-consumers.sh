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

# Truth Mirror off-switch (Ramiro 2026-10-23, open-quake-sr1.3): when
# .truth/config.toml sets `enabled = false`, the Truth Mirror consumer is
# skipped entirely - no CLAIM gate, no pre-push rejection block, no review
# enqueue. A missing config still fails closed via ensure_truth_ready.
truth_disabled() {
	hook_name=$1

	[ -f ".truth/config.toml" ] || return 1
	if grep -Eq '^[[:space:]]*enabled[[:space:]]*=[[:space:]]*false' .truth/config.toml; then
		echo "[$hook_name] Truth Mirror disabled in .truth/config.toml - skipped." >&2
		return 0
	fi
	return 1
}

run_beads_hook() {
	hook_name=$1
	shift

	if ! command -v bd >/dev/null 2>&1; then
		echo "[$hook_name] bd binary not found - counting as consumer error." >&2
		return 1
	fi
	_bd_timeout=${BEADS_HOOK_TIMEOUT:-300}
	_bd_exit=0
	if command -v timeout >/dev/null 2>&1; then
		timeout "$_bd_timeout" bd hooks run "$hook_name" "$@" || _bd_exit=$?
	elif command -v gtimeout >/dev/null 2>&1; then
		gtimeout "$_bd_timeout" bd hooks run "$hook_name" "$@" || _bd_exit=$?
	else
		bd hooks run "$hook_name" "$@" || _bd_exit=$?
	fi
	case $_bd_exit in
	0) return 0 ;;
	# 3 = database not initialized; skip instead of failing.
	3) return 0 ;;
	# 124/142 = timeout wrapper fired; beads is best-effort on latency.
	124 | 142)
		echo "[$hook_name] beads timed out after ${_bd_timeout}s - continuing." >&2
		return 0
		;;
	*) return $_bd_exit ;;
	esac
}

finish_shared_hook_consumers() {
	hook_name=$1
	entire_status=$2
	truth_status=$3
	beads_status=${4:-0}

	if [ "$entire_status" -ne 0 ]; then
		echo "[$hook_name] Entire exited with status $entire_status." >&2
	fi
	if [ "$truth_status" -ne 0 ]; then
		echo "[$hook_name] Truth Mirror exited with status $truth_status." >&2
	fi
	if [ "$beads_status" -ne 0 ]; then
		echo "[$hook_name] Beads exited with status $beads_status." >&2
	fi

	if [ "$entire_status" -ne 0 ] || [ "$truth_status" -ne 0 ] || [ "$beads_status" -ne 0 ]; then
		return 1
	fi
	return 0
}
