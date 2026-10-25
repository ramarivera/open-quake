import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checksumAssets, releaseVersion } from "./release.mjs";

export async function publishRelease({ tag, directory, repository, gh }) {
	const version = releaseVersion(tag);
	const assets = await checksumAssets(directory, version);
	// A failed/unauthorized lookup must fail, rather than treating every API error
	// as a missing release. Listing also works when the first release doesn't exist.
	const releases = JSON.parse(
		gh(
			"api",
			"--paginate",
			"--slurp",
			`repos/${repository}/releases?per_page=100`,
		),
	).flat();
	const existing = releases.find((release) => release.tag_name === tag);
	if (existing && !existing.draft)
		throw new Error(`Refusing to replace published release ${tag}`);
	if (!existing) {
		gh(
			"release",
			"create",
			tag,
			"--verify-tag",
			"--draft",
			"--title",
			`open-quake ${tag}`,
			"--notes-file",
			"docs/release-notes.md",
			...(version.includes("-") ? ["--prerelease"] : []),
		);
	}
	gh(
		"release",
		"upload",
		tag,
		...assets.map((name) => resolve(directory, name)),
		resolve(directory, "SHA256SUMS.txt"),
		"--clobber",
	);
	// Check upload completeness before making the draft visible.
	const uploaded = JSON.parse(gh("release", "view", tag, "--json", "assets"))
		.assets.map((asset) => asset.name)
		.sort();
	const expected = [...assets, "SHA256SUMS.txt"].sort();
	if (JSON.stringify(uploaded) !== JSON.stringify(expected))
		throw new Error("Draft assets do not match the complete release matrix");
	gh(
		"release",
		"edit",
		tag,
		"--draft=false",
		`--prerelease=${version.includes("-")}`,
		`--latest=${!version.includes("-")}`,
	);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	await publishRelease({
		tag: process.env.GITHUB_REF_NAME,
		directory: resolve(process.argv[2]),
		repository: process.env.GITHUB_REPOSITORY,
		gh: (...args) => execFileSync("gh", args, { encoding: "utf8" }),
	});
}
