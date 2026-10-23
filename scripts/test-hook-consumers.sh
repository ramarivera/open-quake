#!/bin/sh
# POSIX port of onyxio's prePushHook.test.ts (fake binaries technique) for the
# Husky -> [repo-gates] -> Entire + Truth Mirror topology in this repo.
#
# Proves, per the migration spec:
#   - consumer order and argument shapes (Entire gets only the remote name on
#     pre-push; Truth Mirror gets Git's full arguments)
#   - gate short-circuiting: a failing .husky/repo-gates.sh stops consumers
#   - independent execution: one consumer's failure does not prevent the other
#   - combined rejection: hook exits nonzero if either consumer errored
#   - strict availability: a missing binary counts as that consumer's error
#
# Divergence from onyxio: this repo DENIES when a consumer binary is missing
# (.truth/TRUTH.md); onyxio soft-skips. Asserted here accordingly.
#
# Usage: scripts/test-hook-consumers.sh   (exit 0 = pass)

set -u

repo_root="$(git rev-parse --show-toplevel)"
hook="$repo_root/.husky/pre-push"

scratch_base="/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake"
[ -d "/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS" ] ||
	{ echo "FAIL: agents scratch volume unavailable" >&2; exit 1; }
mkdir -p "$scratch_base"
scratch="$(mktemp -d "$scratch_base/hook-consumers.XXXXXX")"
# The test swaps .husky/repo-gates.sh for fakes; park the real (tracked) gate
# file and put it back on exit so the suite never deletes it.
gates="$repo_root/.husky/repo-gates.sh"
gates_backup="$scratch/repo-gates.sh.orig"
[ -f "$gates" ] && mv "$gates" "$gates_backup"
restore_gates() {
	rm -f "$gates"
	[ -f "$gates_backup" ] && mv "$gates_backup" "$gates"
	rm -rf "$scratch"
}
trap restore_gates EXIT

FAILS="$scratch/failures"
: >"$FAILS"
ok() { echo "ok: $*"; }
bad() {
	echo "FAIL: $*" >&2
	echo "$*" >>"$FAILS"
}

# Fake bins: log invocations, exit per FAKE_*_EXIT.
fx="$scratch/bin"
mkdir -p "$fx"
for bin in entire truth-mirror bd; do
	{
		echo '#!/bin/sh'
		echo 'printf "%s:%s\n" "'"$bin"'" "$*" >> "$HOOK_LOG"'
		echo 'name="'"$bin"'"; var="FAKE_$(echo "$name" | tr "a-z-" "A-Z_")_EXIT"'
		echo 'eval "exit \${$var:-0}"'
	} >"$fx/$bin"
	chmod +x "$fx/$bin"
done

# Hooks read .truth/config.toml relative to cwd; run from a hermetic cwd so the
# live repo config (which may have Truth Mirror disabled) cannot leak in.
mkdir -p "$scratch/cwd/.truth"
printf 'enabled = true\n' >"$scratch/cwd/.truth/config.toml"
cd "$scratch/cwd" || exit 1

# Keep ensure_truth_ready from prepending real mise shims over our fakes.
export MISE_DATA_DIR="$scratch/mise"
mkdir -p "$MISE_DATA_DIR"

run_hook() { # args: extra-path-component (optional)
	path_prefix="${1:-}"
	HOOK_LOG="$scratch/calls.log" \
		PATH="$path_prefix$fx:/usr/bin:/bin" \
		sh "$hook" origin https://example.test/repo.git
}

calls() { cat "$scratch/calls.log" 2>/dev/null; }

expect_log() {
	expected="$1"
	case "$(calls)" in
	*"$expected"*) ok "log contains: $expected" ;;
	*) bad "log missing: $expected (got: $(calls | tr '\n' '|'))" ;;
	esac
}

rm -f "$scratch/calls.log"
status=0
run_hook || status=$?
[ "$status" -eq 0 ] && ok "happy path exits 0" || bad "happy path exited $status"
expect_log "entire:hooks git pre-push origin"
expect_log "bd:hooks run pre-push origin"
expect_log "truth-mirror:--state-dir .truth hook-dispatch pre-push origin https://example.test/repo.git"
first="$(calls | head -n 1)"
case "$first" in
entire:*) ok "Entire runs before Truth Mirror" ;;
*) bad "expected Entire first, got: $first" ;;
esac

# Gate short-circuiting + ordering.
cat >"$repo_root/.husky/repo-gates.sh" <<'EOF'
echo "gate:$*" >> "${HOOK_LOG:?}"
exit "${FAKE_GATE_EXIT:-0}"
EOF
rm -f "$scratch/calls.log"
status=0
HOOK_LOG="$scratch/calls.log" PATH="$fx:/usr/bin:/bin" \
	sh "$hook" origin https://example.test/repo.git || status=$?
if [ "$status" -eq 0 ]; then
	ok "passing gate keeps exit 0"
else
	bad "passing gate broke the push (exit $status)"
fi
first="$(calls | head -n 1)"
case "$first" in
gate:*) ok "gate runs before both consumers" ;;
*) bad "expected gate first, got: $first" ;;
esac

printf 'exit 7\n' >"$repo_root/.husky/repo-gates.sh"
rm -f "$scratch/calls.log"
status=0
run_hook || status=$?
if [ "$status" -ne 0 ]; then
	ok "failing gate rejects the push"
else
	bad "failing gate did not reject"
fi
if calls | grep -q 'entire:'; then
	bad "consumers ran despite failing gate"
else
	ok "consumers skipped on failing gate"
fi
rm -f "$repo_root/.husky/repo-gates.sh"

# Independent execution + combined rejection: Entire rejects.
rm -f "$scratch/calls.log"
status=0
FAKE_ENTIRE_EXIT=23 run_hook || status=$?
if [ "$status" -ne 0 ]; then
	ok "push rejected when Entire errors"
else
	bad "push not rejected on Entire error"
fi
expect_log "entire:hooks git pre-push origin"
expect_log "bd:hooks run pre-push origin"
expect_log "truth-mirror:--state-dir .truth hook-dispatch pre-push origin https://example.test/repo.git"

# Independent execution + combined rejection: Truth Mirror rejects.
rm -f "$scratch/calls.log"
status=0
FAKE_TRUTH_MIRROR_EXIT=29 run_hook || status=$?
if [ "$status" -ne 0 ]; then
	ok "push rejected when Truth Mirror errors"
else
	bad "push not rejected on Truth Mirror error"
fi
expect_log "entire:hooks git pre-push origin"
expect_log "bd:hooks run pre-push origin"
expect_log "truth-mirror:--state-dir .truth hook-dispatch pre-push origin https://example.test/repo.git"

# Strict availability: missing sibling must not silently pass.
# NOTE: POSIX keeps VAR=value prefixes on function calls for the rest of the
# shell, so every later invocation resets both exit codes explicitly.
mkdir -p "$scratch/only-truth" "$scratch/only-entire"
cp "$fx/truth-mirror" "$scratch/only-truth/"
cp "$fx/entire" "$scratch/only-entire/"

rm -f "$scratch/calls.log"
status=0
FAKE_ENTIRE_EXIT=0 FAKE_TRUTH_MIRROR_EXIT=0 \
	HOOK_LOG="$scratch/calls.log" PATH="/usr/bin:/bin" MISE_DATA_DIR="$scratch/mise" \
	sh "$hook" origin x || status=$?
if [ "$status" -ne 0 ]; then
	ok "missing both binaries rejects"
else
	bad "missing both binaries passed"
fi

rm -f "$scratch/calls.log"
status=0
FAKE_ENTIRE_EXIT=0 FAKE_TRUTH_MIRROR_EXIT=0 \
	HOOK_LOG="$scratch/calls.log" PATH="$scratch/only-truth:/usr/bin:/bin" MISE_DATA_DIR="$scratch/mise" \
	sh "$hook" origin x || status=$?
if [ "$status" -ne 0 ]; then
	ok "missing Entire rejects (strict)"
else
	bad "missing Entire silently passed"
fi
calls | grep -q 'truth-mirror:' &&
	ok "Truth Mirror still ran when Entire was absent" ||
	bad "Truth Mirror did not run when Entire was absent"

rm -f "$scratch/calls.log"
status=0
FAKE_ENTIRE_EXIT=0 FAKE_TRUTH_MIRROR_EXIT=0 \
	HOOK_LOG="$scratch/calls.log" PATH="$scratch/only-entire:/usr/bin:/bin" MISE_DATA_DIR="$scratch/mise" \
	sh "$hook" origin x || status=$?
if [ "$status" -ne 0 ]; then
	ok "missing Truth Mirror rejects (strict)"
else
	bad "missing Truth Mirror silently passed"
fi
calls | grep -q 'entire:' &&
	ok "Entire still ran when Truth Mirror was absent" ||
	bad "Entire did not run when Truth Mirror was absent"

# Off-switch: `enabled = false` skips Truth Mirror entirely (even a rejecting
# one), while a missing config still fails closed.
printf 'enabled = false\n' >"$scratch/cwd/.truth/config.toml"
rm -f "$scratch/calls.log"
status=0
FAKE_ENTIRE_EXIT=0 FAKE_TRUTH_MIRROR_EXIT=29 run_hook || status=$?
[ "$status" -eq 0 ] && ok "disabled Truth Mirror does not reject" ||
	bad "disabled Truth Mirror still rejected (exit $status)"
calls | grep -q 'truth-mirror:' &&
	bad "Truth Mirror ran while disabled" ||
	ok "Truth Mirror skipped while disabled"
expect_log "entire:hooks git pre-push origin"
expect_log "bd:hooks run pre-push origin"

rm -f "$scratch/cwd/.truth/config.toml"
rm -f "$scratch/calls.log"
status=0
FAKE_ENTIRE_EXIT=0 FAKE_TRUTH_MIRROR_EXIT=0 run_hook || status=$?
[ "$status" -ne 0 ] && ok "missing config still rejects" ||
	bad "missing config silently passed"

if [ -s "$FAILS" ]; then
	echo "FAILED" >&2
	exit 1
fi
echo PASS
