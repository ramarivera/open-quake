import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import appleSigning from "../build/apple-signing.cjs";
import { downloadName, electronEnvironment } from "./release.mjs";
import { verifyAppleApp } from "./verify-apple-signing.mjs";
import {
	installWindowsPackage,
	waitForWindowsPackage,
} from "./windows-package-install.mjs";

const command = promisify(execFile);
const directory = resolve(process.argv[2] || "dist");
const version = process.env.RELEASE_VERSION;
assert.ok(version, "RELEASE_VERSION must identify the downloads under test");
const scratch = await mkdtemp(join(tmpdir(), "open-quake-package-"));

async function smoke(executable, args = []) {
	const userData = await mkdtemp(join(scratch, "user-data-"));
	const child = spawn(executable, [...args, "--package-smoke"], {
		env: {
			...electronEnvironment(process.env),
			PACKAGE_SMOKE_DATA: userData,
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
		assert.equal(code, 0, "Distributed Electron must exit successfully");
		assert.ok(
			stdout.includes(
				`PACKAGE_SMOKE_PASS ${process.platform} ${process.arch} ${version}`,
			),
		);
	} finally {
		clearTimeout(timer);
	}
}

try {
	const files = await readdir(directory);
	const download = (extension) => {
		const os = { darwin: "mac", win32: "win", linux: "linux" }[
			process.platform
		];
		const name = downloadName(version, os, process.arch, extension);
		assert.ok(files.includes(name), `Missing distributed download ${name}`);
		return join(directory, name);
	};
	if (process.platform === "darwin") {
		const mount = join(scratch, "volume");
		await mkdir(mount);
		await command(
			"hdiutil",
			[
				"attach",
				download("dmg"),
				"-readonly",
				"-nobrowse",
				"-mountpoint",
				mount,
			],
			{ timeout: 60_000 },
		);
		try {
			if (appleSigning.appleSigningRequired())
				await verifyAppleApp(join(mount, "open-quake.app"));
			await smoke(join(mount, "open-quake.app/Contents/MacOS/open-quake"));
		} finally {
			await command("hdiutil", ["detach", mount], { timeout: 30_000 });
		}
		const extracted = join(scratch, "zip");
		await command("ditto", ["-x", "-k", download("zip"), extracted]);
		if (appleSigning.appleSigningRequired())
			await verifyAppleApp(join(extracted, "open-quake.app"));
		await smoke(join(extracted, "open-quake.app/Contents/MacOS/open-quake"));
	} else if (process.platform === "win32") {
		const installed = join(scratch, "installed");
		console.info(`Installing Windows ${process.arch} download`);
		await installWindowsPackage({ installer: download("exe"), installed });
		console.info("Windows installer completed");
		try {
			await smoke(join(installed, "open-quake.exe"));
		} finally {
			await command(join(installed, "Uninstall open-quake.exe"), ["/S"], {
				timeout: 120_000,
			});
			await waitForWindowsPackage(download("exe"), installed);
		}
	} else if (process.platform === "linux") {
		// Installing the DEB also establishes the shipped sandbox helper's owner
		// and permissions. This only runs on the disposable native CI runner.
		await command("sudo", ["apt-get", "install", "-y", download("deb")], {
			timeout: 120_000,
		});
		try {
			await smoke("/opt/open-quake/open-quake");
			await smoke(download("AppImage"), ["--appimage-extract-and-run"]);
		} finally {
			await command("sudo", ["apt-get", "remove", "-y", "open-quake"], {
				timeout: 60_000,
			});
		}
	} else {
		throw new Error(`Unsupported package host ${process.platform}`);
	}
} finally {
	await rm(scratch, {
		recursive: true,
		force: true,
		maxRetries: 10,
		retryDelay: 200,
	});
}
