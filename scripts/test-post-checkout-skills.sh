#!/bin/sh
# Isolated-repository test for .husky/post-checkout local-skill propagation.
#
# Scenario A - same-revision worktree, hook invoked directly:
#   ignored-only skill        -> every file copied
#   partial-ignore skill      -> ignored SKILL.md copied, unignored secret.md NOT
#   untracked-not-ignored     -> nothing copied (absent entirely)
#   mixed tracked+ignored     -> tracked file from the revision; the IGNORED
#                                extra must NOT leak in (no directory copy)
#   fully tracked             -> revision-owned only (content == committed blob)
#
# Scenario B - divergent history, hook invoked with Git's production-style
# environment (GIT_DIR/GIT_WORK_TREE pointing at an OLDER target revision):
#   mixed tracked+ignored skill present in main tree but absent from the
#   target revision -> NOTHING copied into the target.
#
# Scratch space lives under /Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS per the
# agent constraint; the script errors out if that volume is unavailable.
#
# Usage: scripts/test-post-checkout-skills.sh   (exit 0 = pass)

set -eu

repo_root="$(git rev-parse --show-toplevel)"
hook="$repo_root/.husky/post-checkout"

# Scratch space per agent constraint.
scratch_base="/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake"
[ -d "/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS" ] ||
	{ echo "FAIL: agents scratch volume unavailable" >&2; exit 1; }
mkdir -p "$scratch_base"
scratch="$(mktemp -d "$scratch_base/post-checkout-skills.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

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

# Run the hook from inside the worktree WITHOUT clearing env first, then with
# a hostile inherited environment; both must produce identical results.
for hostile in "" "with-git-env"; do
	# Reset only propagation output; tracked checkout files must survive.
	rm -rf "$scratch/wt/.agents/skills/ignored-skill" \
		"$scratch/wt/.agents/skills/partial-skill"
	if [ "$hostile" = "with-git-env" ]; then
		(
			cd "$scratch/wt"
			GIT_DIR="$(git rev-parse --absolute-git-dir)" \
				GIT_INDEX_FILE="$scratch/wt/.git-index-leak" \
				sh "$main/.husky-src-hook.sh" 2>/dev/null
		)
	else
		(cd "$scratch/wt" && sh "$main/.husky-src-hook.sh" 2>/dev/null)
	fi

	fail=0
	check() { # check <present|absent> <path> [expected-content]
		mode="$1"; path="$2"
		case "$mode" in
		present)
			if [ -e "$path" ]; then echo "ok: $path present"; else
				echo "FAIL: $path expected present"; fail=1; fi
			;;
		absent)
			if [ ! -e "$path" ]; then echo "ok: $path absent"; else
				echo "FAIL: $path expected absent"; fail=1; fi
			;;
		esac
	}
	content_is() {
		if [ "$(cat "$1" 2>/dev/null)" = "$2" ]; then
			echo "ok: $1 content matches"
		else
			echo "FAIL: $1 content mismatch"; fail=1
		fi
	}

	(
		cd "$scratch/wt"
		check present ".agents/skills/ignored-skill/SKILL.md"
		content_is ".agents/skills/ignored-skill/SKILL.md" "ignored"
		check present ".agents/skills/partial-skill/SKILL.md"
		content_is ".agents/skills/partial-skill/SKILL.md" "partial"
		check absent ".agents/skills/partial-skill/secret.md"
		check absent ".agents/skills/untracked-skill/SKILL.md"
		check present ".agents/skills/mixed-skill/SKILL.md"
		content_is ".agents/skills/mixed-skill/SKILL.md" "mixed-tracked"
		check absent ".agents/skills/mixed-skill/notes.md"
		check present ".agents/skills/tracked-skill/SKILL.md"
		content_is ".agents/skills/tracked-skill/SKILL.md" "tracked"
	)

	if [ "$fail" -eq 0 ]; then
		echo "ok: scenario A ($hostile) PASS"
	else
		echo "FAILED: scenario A ($hostile)" >&2
		exit 1
	fi
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

# Production-style invocation: git exports GIT_DIR/GIT_WORK_TREE of the TARGET.
(
	cd "$scratch/wt-old"
	GIT_DIR="$(git rev-parse --absolute-git-dir)" \
		GIT_WORK_TREE="$scratch/wt-old" \
		sh "$main/.husky-src-hook.sh" 2>/dev/null
)

fail=0
(
	cd "$scratch/wt-old"
	for p in ".agents/skills/divergent-skill" \
		".agents/skills/divergent-skill/SKILL.md" \
		".agents/skills/divergent-skill/secret.txt" \
		".agents/skills/divergent-skill/code.txt" \
		".agents/skills/mixed-skill/notes.md"; do
		if [ ! -e "$p" ]; then
			echo "ok: $p absent in older target"
		else
			echo "FAIL: $p leaked into older target"; fail=1
		fi
	done
	[ -e base.txt ] && echo "ok: base.txt present (v1 checkout intact)"
)

if [ "$fail" -eq 0 ]; then
	echo "PASS"
else
	echo "FAILED" >&2
	exit 1
fi
