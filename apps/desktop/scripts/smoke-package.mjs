import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = resolve(process.argv[2] || "dist");
const scratch = await mkdtemp(join(tmpdir(), "open-quake-package-"));
try {
	let executable;
	if (process.platform === "darwin") {
		executable = join(
			directory,
			"mac-arm64/open-quake.app/Contents/MacOS/open-quake",
		);
	} else {
		const prefix = process.platform === "win32" ? "win" : "linux";
		const arch = process.arch === "x64" ? "" : `${process.arch}-`;
		const unpacked = join(directory, `${prefix}-${arch}unpacked`);
		const name = process.platform === "win32" ? "open-quake.exe" : "open-quake";
		assert.ok(
			(await readdir(unpacked)).includes(name),
			`Missing packaged executable ${name}`,
		);
		executable = join(unpacked, name);
	}
	const child = spawn(executable, ["--package-smoke"], {
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: "",
			PACKAGE_SMOKE_DATA: scratch,
			RELEASE_ARCH: process.arch,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
		process.stdout.write(chunk);
	});
	child.stderr.pipe(process.stderr);
	const timer = setTimeout(() => child.kill(), 40_000);
	try {
		const code = await new Promise((resolveExit, reject) => {
			child.on("error", reject);
			child.on("close", resolveExit);
		});
		assert.equal(code, 0, "Packaged Electron must exit successfully");
		assert.ok(
			stdout.includes(
				`PACKAGE_SMOKE_PASS ${process.platform} ${process.arch} ${process.env.RELEASE_VERSION}`,
			),
		);
	} finally {
		clearTimeout(timer);
	}
} finally {
	await rm(scratch, {
		recursive: true,
		force: true,
		maxRetries: 10,
		retryDelay: 200,
	});
}
