import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

/** Build the reviewed source locally; no network or downloaded executable. */
export function buildNativeMedia(root: string): void {
	if (process.platform !== "darwin") return;
	const source = resolve(root, "vendor/mediaremote-adapter");
	const output = resolve(root, "out/native-media");
	const framework = join(output, "MediaRemoteAdapter.framework");
	const files = ["adapter", "private", "utility"].flatMap((directory) =>
		readdirSync(join(source, "src", directory))
			.filter((file) => file.endsWith(".m"))
			.sort()
			.map((file) => join(source, "src", directory, file)),
	);
	const headers = ["adapter", "private", "utility"].flatMap((directory) =>
		readdirSync(join(source, "src", directory))
			.filter((file) => file.endsWith(".h"))
			.sort()
			.map((file) => join(source, "src", directory, file)),
	);
	const hash = createHash("sha256").update(
		readFileSync(join(root, "native-media-build.ts")),
	);
	for (const file of [
		...files,
		...headers,
		join(source, "include/MediaRemoteAdapter.h"),
		join(source, "bin/mediaremote-adapter.pl"),
		join(source, "LICENSE"),
	])
		hash.update(readFileSync(file));
	const fingerprint = hash.digest("hex");
	const stamp = join(output, "source.sha256");
	if (
		existsSync(stamp) &&
		existsSync(join(framework, "MediaRemoteAdapter")) &&
		existsSync(join(framework, "Info.plist")) &&
		existsSync(join(output, "mediaremote-adapter.pl")) &&
		existsSync(join(output, "LICENSE")) &&
		readFileSync(stamp, "utf8") === fingerprint
	)
		return;
	mkdirSync(framework, { recursive: true });
	execFileSync(
		"/usr/bin/xcrun",
		[
			"clang",
			"-dynamiclib",
			"-arch",
			"arm64",
			"-mmacosx-version-min=12.0",
			"-fobjc-arc",
			"-fvisibility=default",
			"-I",
			join(source, "include"),
			"-I",
			join(source, "src"),
			...files,
			"-framework",
			"Foundation",
			"-framework",
			"AppKit",
			"-framework",
			"UniformTypeIdentifiers",
			"-o",
			join(framework, "MediaRemoteAdapter"),
		],
		{ stdio: "inherit", timeout: 120_000 },
	);
	writeFileSync(
		join(framework, "Info.plist"),
		'<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>net.roxasroot.open-quake.MediaRemoteAdapter</string><key>CFBundleExecutable</key><string>MediaRemoteAdapter</string><key>CFBundlePackageType</key><string>FMWK</string><key>CFBundleVersion</key><string>1</string></dict></plist>',
	);
	execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", framework], {
		stdio: "inherit",
		timeout: 30_000,
	});
	copyFileSync(
		join(source, "bin/mediaremote-adapter.pl"),
		join(output, "mediaremote-adapter.pl"),
	);
	copyFileSync(join(source, "LICENSE"), join(output, "LICENSE"));
	writeFileSync(stamp, fingerprint);
}
