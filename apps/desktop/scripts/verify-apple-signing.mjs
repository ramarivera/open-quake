import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import policy from "../build/apple-signing.cjs";

const execute = promisify(execFile);
const command = (tool, args) => execute(tool, args, { timeout: 120_000 });

// Run against the app extracted from each shipped format, before launching it.
// These commands inspect signatures/tickets and never request signing access.
export async function verifyAppleApp(app, run = command) {
	await run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
	const { stderr } = await run("codesign", ["--display", "--verbose=4", app]);
	assert.ok(
		stderr.includes(
			`Authority=Developer ID Application: ${policy.APPLE_IDENTITY}\n`,
		),
		"Packaged app must carry the expected Developer ID Application authority",
	);
	assert.ok(
		stderr.includes(`TeamIdentifier=${policy.APPLE_TEAM}\n`),
		"Packaged app must belong to the expected Apple team",
	);
	assert.match(stderr, /^CodeDirectory .*flags=.*\bruntime\b/m);
	assert.match(stderr, /^Timestamp=.+/m);
	// @electron/notarize staples the app before builder creates the DMG/ZIP.
	// Validate that ticket survived packaging, including the ZIP round trip.
	await run("xcrun", ["stapler", "validate", app]);
	await run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	assert.equal(
		process.platform,
		"darwin",
		"Apple artifact checks require macOS",
	);
	assert.ok(
		process.argv[2],
		"Usage: node scripts/verify-apple-signing.mjs path/to/app",
	);
	await verifyAppleApp(resolve(process.argv[2]));
}
