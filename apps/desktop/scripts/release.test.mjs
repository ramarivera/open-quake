import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publishRelease } from "./publish-release.mjs";
import {
	checksumAssets,
	downloadName,
	electronEnvironment,
	expectedAssets,
	releaseVersion,
} from "./release.mjs";

test("accepts stable and prerelease tags, rejects unsafe or ambiguous versions", () => {
	for (const tag of [
		"v0.1.0",
		"v12.34.56",
		"v1.0.0-beta.2",
		"v1.0.0-0",
		"v1.0.0-1rc",
	]) {
		assert.equal(releaseVersion(tag), tag.slice(1));
	}
	for (const tag of [
		"1.0.0",
		"v01.0.0",
		"v1.0",
		"v1.0.0-01",
		"v1.0.0-a..b",
		"v1.0.0\n",
		"v1.0.0+meta",
		"v1.0.0/../bad",
		"--help",
	]) {
		assert.throws(() => releaseVersion(tag), /Invalid version/);
	}
});

test("release requires all eight downloads, excludes Intel Mac, detects missing and empty assets", async () => {
	const directory = await mkdtemp(join(tmpdir(), "open-quake-release-test-"));
	try {
		const expected = expectedAssets("1.2.3");
		assert.equal(expected.length, 8);
		assert.equal(
			expected.some((name) => name.includes("mac-x64")),
			false,
		);
		await assert.rejects(checksumAssets(directory, "1.2.3"), /mismatch/);
		for (const asset of expected)
			await writeFile(join(directory, asset), "hello");
		await checksumAssets(directory, "1.2.3");
		const sums = await readFile(join(directory, "SHA256SUMS.txt"), "utf8");
		assert.equal(sums.trim().split("\n").length, 8);
		assert.ok(
			sums.includes(
				`2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824  ${expected[0]}`,
			),
		);
		await checksumAssets(directory, "1.2.3");
		await writeFile(join(directory, expected[0]), "");
		await assert.rejects(checksumAssets(directory, "1.2.3"), /Empty/);
		await writeFile(join(directory, expected[0]), "hello");
		await writeFile(join(directory, "unexpected.exe"), "extra");
		await assert.rejects(checksumAssets(directory, "1.2.3"), /mismatch/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

for (const scenario of [
	"stable",
	"prerelease",
	"existing-draft",
	"published",
	"lookup-error",
	"upload-error",
	"incomplete-upload",
]) {
	test(`publication safety: ${scenario}`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "open-quake-publish-test-"));
		const tag = scenario === "prerelease" ? "v1.2.3-beta.1" : "v1.2.3";
		const version = releaseVersion(tag);
		const assets = [...expectedAssets(version), "SHA256SUMS.txt"];
		const calls = [];
		try {
			for (const asset of expectedAssets(version))
				await writeFile(join(directory, asset), "installer");
			const gh = (...args) => {
				calls.push(args);
				if (args[0] === "api") {
					if (scenario === "lookup-error") throw new Error("API unauthorized");
					return JSON.stringify([
						[
							...(scenario === "published" || scenario === "existing-draft"
								? [{ tag_name: tag, draft: scenario === "existing-draft" }]
								: []),
						],
					]);
				}
				if (args[1] === "upload" && scenario === "upload-error")
					throw new Error("Upload failed");
				if (args[1] === "view")
					return JSON.stringify({
						assets: (scenario === "incomplete-upload"
							? assets.slice(1)
							: assets
						).map((name) => ({ name })),
					});
				return "";
			};
			const publish = () =>
				publishRelease({ tag, directory, repository: "example/repo", gh });
			if (
				[
					"published",
					"lookup-error",
					"upload-error",
					"incomplete-upload",
				].includes(scenario)
			) {
				await assert.rejects(publish());
				assert.equal(
					calls.some((args) => args[1] === "edit"),
					false,
				);
				if (["published", "lookup-error"].includes(scenario))
					assert.equal(
						calls.some((args) => args[1] === "upload"),
						false,
					);
			} else {
				await publish();
				const create = calls.find((args) => args[1] === "create");
				if (scenario === "existing-draft") assert.equal(create, undefined);
				else {
					assert.ok(create.includes("--draft"));
					assert.ok(create.includes("--verify-tag"));
				}
				assert.equal(calls.at(-1)[1], "edit");
				assert.ok(
					calls.at(-1).includes(`--latest=${scenario !== "prerelease"}`),
				);
				assert.ok(
					calls.at(-1).includes(`--prerelease=${scenario === "prerelease"}`),
				);
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
}

// Compare with the pinned builder's actual macro expansion instead of only
// constructing fixture files from the same manifest we are testing.
test("download names match the pinned builder for every distributed format", () => {
	const require = createRequire(import.meta.url);
	const builderRequire = createRequire(require.resolve("electron-builder"));
	const { Arch, getArtifactArchName } = builderRequire("builder-util");
	const { artifactName } = require("../electron-builder.config.cjs");
	for (const [platform, arch, extension] of [
		["mac", "arm64", "dmg"],
		["mac", "arm64", "zip"],
		...["x64", "arm64"].flatMap((arch) => [
			["win", arch, "exe"],
			["linux", arch, "deb"],
			["linux", arch, "AppImage"],
		]),
	]) {
		const expanded = artifactName
			.replaceAll("$" + "{version}", "1.2.3")
			.replaceAll("$" + "{os}", platform)
			.replaceAll("$" + "{arch}", getArtifactArchName(Arch[arch], extension))
			.replaceAll("$" + "{ext}", extension);
		assert.equal(downloadName("1.2.3", platform, arch, extension), expanded);
		assert.ok(expectedAssets("1.2.3").includes(expanded));
	}
});

test("packaged Electron never inherits Node mode, including Windows key casing", () => {
	for (const key of ["ELECTRON_RUN_AS_NODE", "electron_run_as_node"]) {
		for (const value of ["1", ""]) {
			const source = { [key]: value, PATH: "keep", RELEASE_VERSION: "1.2.3" };
			const child = electronEnvironment(source);
			assert.equal(
				Object.keys(child).some(
					(name) => name.toUpperCase() === "ELECTRON_RUN_AS_NODE",
				),
				false,
			);
			assert.equal(child.PATH, "keep");
			assert.equal(child.RELEASE_VERSION, "1.2.3");
			assert.equal(source[key], value);
		}
	}
});
