#!/bin/sh
# Isolated-repository test for .husky/post-checkout local-skill propagation.
#
# Scenario A - same-revision worktree:
#   ignored-only skill        -> every file copied
#   partial-ignore skill      -> ignored SKILL.md copied, unignored secret.md NOT
#   untracked-not-ignored     -> nothing copied (absent entirely)
#   mixed tracked+ignored     -> tracked file from the revision; the IGNORED
#                                extra must NOT leak in (no directory copy)
#   fully tracked             -> revision-owned only (content == committed blob)
#   Run twice: clean environment, then with hostile inherited git env vars.
#
# Scenario B - divergent history with production-style hook env
# (GIT_DIR/GIT_WORK_TREE pointing at an OLDER target revision):
#   mixed tracked+ignored skill present in main tree but absent from the
#   target revision -> NOTHING copied into the target.
#
# Scratch space lives under /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS per the
# agent constraint; the script errors out if that volume is unavailable.
#
# Usage: scripts/test-post-checkout-skills.sh   (exit 0 = pass)

repo_root="$(git rev-parse --show-toplevel)"
hook="$repo_root/.husky/post-checkout"

# Isolation: drop git-local env vars inherited from the caller BEFORE any
# operation on the synthetic repository (GIT_INDEX_FILE=.git/index et al.
# otherwise break nested repos - review findings on 8aee537/9216c81).
for var in $(git rev-parse --local-env-vars); do
	unset "$var" 2>/dev/null || true
done

# Scratch space per agent constraint.
scratch_base="/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake"
[ -d "/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS" ] ||
	{ echo "FAIL: agents scratch volume unavailable" >&2; exit 1; }
mkdir -p "$scratch_base"
scratch="$(mktemp -d "$scratch_base/post-checkout-skills.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

FAILS="$scratch/failures"
: >"$FAILS"

ok() { echo "ok: $*"; }
bad() {
	echo "FAIL: $*" >&2
	echo "$*" >>"$FAILS"
}
expect_present() { [ -e "$1" ] && ok "$1 present" || bad "$1 expected present"; }
expect_absent() { [ ! -e "$1" ] && ok "$1 absent" || bad "$1 expected absent"; }
expect_content() {
	if [ "$(cat "$1" 2>/dev/null)" = "$2" ]; then
		ok "$1 content matches"
	else
		bad "$1 content mismatch"
	fi
}

main="$scratch/main"
mkdir -p "$main"
cd "$main"
git init -q
git config user.email test@example.com
git config user.name test

# ---------------------------------------------------------------- fixtures --
mkdir -p .agents/skills/ignored-skill \
	.agents/skills/partial-skill \
	.agents/skills/untracked-skill \
	.agents/skills/mixed-skill \
	.agents/skills/tracked-skill

printf -- '*\n' >.agents/skills/ignored-skill/.gitignore
echo "ignored" >.agents/skills/ignored-skill/SKILL.md

# Partial: SKILL.md explicitly ignored, sibling secret.md deliberately NOT.
printf -- 'SKILL.md\n' >.agents/skills/partial-skill/.gitignore
echo "partial" >.agents/skills/partial-skill/SKILL.md
echo "TOP-SECRET" >.agents/skills/partial-skill/secret.md

echo "untracked" >.agents/skills/untracked-skill/SKILL.md

echo "mixed-tracked" >.agents/skills/mixed-skill/SKILL.md
printf -- 'notes.md\n' >.agents/skills/mixed-skill/.gitignore
echo "mixed-notes" >.agents/skills/mixed-skill/notes.md

echo "tracked" >.agents/skills/tracked-skill/SKILL.md

git add .agents/skills/mixed-skill/SKILL.md .agents/skills/tracked-skill
git commit -qm fixtures

cp "$hook" .husky-src-hook.sh

# ------------------------------------------------- Scenario A: same commit --
git worktree add -q "$scratch/wt" --detach >/dev/null

for hostile in "" "with-git-env"; do
	# Reset only propagation output; tracked checkout files must survive.
	rm -rf "$scratch/wt/.agents/skills/ignored-skill" \
		"$scratch/wt/.agents/skills/partial-skill"
	cd "$scratch/wt"
	if [ "$hostile" = "with-git-env" ]; then
		GIT_DIR="$scratch/wt/.git" GIT_INDEX_FILE="$scratch/wt/.index-leak" \
			sh "$main/.husky-src-hook.sh" 2>/dev/null
	else
		sh "$main/.husky-src-hook.sh" 2>/dev/null
	fi

	expect_present ".agents/skills/ignored-skill/SKILL.md"
	expect_content ".agents/skills/ignored-skill/SKILL.md" "ignored"
	expect_present ".agents/skills/partial-skill/SKILL.md"
	expect_content ".agents/skills/partial-skill/SKILL.md" "partial"
	expect_absent ".agents/skills/partial-skill/secret.md"
	expect_absent ".agents/skills/untracked-skill/SKILL.md"
	# Mixed skill: tracked file arrives from the REVISION; ignored extra must
	# not leak in via a directory copy.
	expect_present ".agents/skills/mixed-skill/SKILL.md"
	expect_content ".agents/skills/mixed-skill/SKILL.md" "mixed-tracked"
	expect_absent ".agents/skills/mixed-skill/notes.md"
	# Fully tracked skill: revision-owned only.
	expect_present ".agents/skills/tracked-skill/SKILL.md"
	expect_content ".agents/skills/tracked-skill/SKILL.md" "tracked"

	if [ -s "$FAILS" ]; then
		echo "FAILED: scenario A ($hostile)" >&2
		exit 1
	fi
	echo "ok: scenario A ($hostile) PASS"
done

# ------------- Scenario B: divergent history + production-style hook env ----
cd "$main"
git checkout -q -b mainline
echo v1 >base.txt && git add base.txt && git commit -qm v1
V1="$(git rev-parse HEAD)"

mkdir -p .agents/skills/divergent-skill
printf -- 'secret.txt\n' >.agents/skills/divergent-skill/.gitignore
echo "divergent" >.agents/skills/divergent-skill/SKILL.md
echo "SECRET" >.agents/skills/divergent-skill/secret.txt
echo code >.agents/skills/divergent-skill/code.txt
git add .agents/skills/divergent-skill/code.txt
git commit -qm v2-mixed

# Older target revision: divergent-skill does not exist there at all.
git worktree add -q "$scratch/wt-old" "$V1" >/dev/null

cd "$scratch/wt-old"
# Production-style invocation: git exports GIT_DIR/GIT_WORK_TREE of the TARGET.
GIT_DIR="$(git rev-parse --absolute-git-dir)" GIT_WORK_TREE="$scratch/wt-old" \
	sh "$main/.husky-src-hook.sh" 2>/dev/null

for p in .agents/skills/divergent-skill \
	.agents/skills/divergent-skill/SKILL.md \
	.agents/skills/divergent-skill/secret.txt \
	.agents/skills/divergent-skill/code.txt \
	.agents/skills/mixed-skill/notes.md; do
	expect_absent "$p"
done
expect_present base.txt

if [ -s "$FAILS" ]; then
	echo "FAILED: scenario B" >&2
	exit 1
fi
echo PASS
