#!/bin/sh
# Isolated-repository test for .husky/post-checkout local-skill propagation.
#
# Builds a scratch git repo with four skill fixtures, adds a worktree, and
# runs the hook the same way git does (cwd = worktree, hook script resolved
# from the main working tree). Asserts:
#   ignored-only skill      -> copied into the worktree
#   untracked-not-ignored   -> NOT copied (absent entirely)
#   mixed tracked+ignored   -> tracked file from the revision; the IGNORED
#                              extra file must NOT leak in (no directory copy)
#   fully tracked           -> revision-owned only (content == committed blob)
#
# Usage: scripts/test-post-checkout-skills.sh   (exit 0 = pass)

set -eu

repo_root="$(git rev-parse --show-toplevel)"
hook="$repo_root/.husky/post-checkout"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/post-checkout-skills.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

main="$scratch/main"
mkdir -p "$main"
cd "$main"
git init -q
git config user.email test@example.com
git config user.name test

mkdir -p .agents/skills/ignored-skill \
	.agents/skills/untracked-skill \
	.agents/skills/mixed-skill \
	.agents/skills/tracked-skill

printf -- '*\n' >.agents/skills/ignored-skill/.gitignore
echo "ignored" >.agents/skills/ignored-skill/SKILL.md

echo "untracked" >.agents/skills/untracked-skill/SKILL.md

echo "mixed-tracked" >.agents/skills/mixed-skill/SKILL.md
printf -- 'notes.md\n' >.agents/skills/mixed-skill/.gitignore
echo "mixed-notes" >.agents/skills/mixed-skill/notes.md

echo "tracked" >.agents/skills/tracked-skill/SKILL.md

git add .agents/skills/mixed-skill/SKILL.md .agents/skills/tracked-skill
git commit -qm fixtures

cp "$hook" .husky-src-hook.sh

git worktree add -q "$scratch/wt" --detach >/dev/null
cd "$scratch/wt"

# Run the hook exactly as git does: cwd = worktree, script from main tree.
sh "$main/.husky-src-hook.sh"

fail=0
expect_present() {
	if [ -e "$1" ]; then
		echo "ok: $1 present"
	else
		echo "FAIL: $1 expected present"; fail=1
	fi
}
expect_absent() {
	if [ ! -e "$1" ]; then
		echo "ok: $1 absent"
	else
		echo "FAIL: $1 expected absent"; fail=1
	fi
}
expect_content() {
	if [ "$(cat "$1")" = "$2" ]; then
		echo "ok: $1 content matches"
	else
		echo "FAIL: $1 content mismatch"; fail=1
	fi
}

expect_present ".agents/skills/ignored-skill/SKILL.md"
expect_content ".agents/skills/ignored-skill/SKILL.md" "ignored"

expect_absent ".agents/skills/untracked-skill/SKILL.md"

# Mixed skill: the tracked file arrives from the REVISION; the ignored extra
# must not leak in via a directory copy.
expect_present ".agents/skills/mixed-skill/SKILL.md"
expect_content ".agents/skills/mixed-skill/SKILL.md" "mixed-tracked"
expect_absent ".agents/skills/mixed-skill/notes.md"

# Fully tracked skill: revision-owned only.
expect_present ".agents/skills/tracked-skill/SKILL.md"
expect_content ".agents/skills/tracked-skill/SKILL.md" "tracked"

if [ "$fail" -eq 0 ]; then
	echo "PASS"
else
	echo "FAILED" >&2
	exit 1
fi
