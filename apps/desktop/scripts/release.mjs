import { createHash } from "node:crypto";
import {
	appendFile,
	readdir,
	readFile,
	stat,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function releaseVersion(tag) {
	const number = "(?:0|[1-9][0-9]*)";
	const identifier = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
	const semver = new RegExp(
		`^v(${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?)$`,
	);
	const match = semver.exec(tag);
	if (!match || match[1].length > 100)
		throw new Error(`Invalid version tag: ${tag}`);
	return match[1];
}

export function expectedAssets(version) {
	releaseVersion(`v${version}`);
	return [
		`open-quake-${version}-mac-arm64.dmg`,
		`open-quake-${version}-mac-arm64.zip`,
		...["x64", "arm64"].flatMap((arch) => [
			`open-quake-${version}-win-${arch}.exe`,
			`open-quake-${version}-linux-${arch}.AppImage`,
			`open-quake-${version}-linux-${arch}.deb`,
		]),
	].sort();
}

export async function checksumAssets(directory, version) {
	const expected = expectedAssets(version);
	const actual = (await readdir(directory))
		.filter((name) => name !== "SHA256SUMS.txt")
		.sort();
	if (JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(
			`Release asset mismatch. Expected ${expected.join(", ")}; found ${actual.join(", ")}`,
		);
	}
	const lines = [];
	for (const name of expected) {
		const path = join(directory, name);
		if (!(await stat(path)).isFile() || (await stat(path)).size === 0) {
			throw new Error(`Empty or invalid release asset: ${name}`);
		}
		const hash = createHash("sha256")
			.update(await readFile(path))
			.digest("hex");
		lines.push(`${hash}  ${name}`);
	}
	await writeFile(join(directory, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
	return expected;
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const [command, input] = process.argv.slice(2);
	if (command === "version") {
		const version = releaseVersion(input);
		console.info(version);
		if (process.env.GITHUB_OUTPUT)
			await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
	} else if (command === "checksums") {
		await checksumAssets(input, process.env.RELEASE_VERSION);
	} else {
		throw new Error(
			"Usage: release.mjs version <vSemVer> | checksums <directory>",
		);
	}
}
