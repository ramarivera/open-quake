import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import policy from "../build/apple-signing.cjs";
import { verifyAppleApp } from "./verify-apple-signing.mjs";

const credentials = {
	OPEN_QUAKE_APPLE_SIGNING: "1",
	APPLE_TEAM_ID: policy.APPLE_TEAM,
	APPLE_KEYCHAIN_PROFILE: "test-profile-name",
};
const tag = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/tags/v1.2.3" };
const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder"));
const appBuilderRequire = createRequire(
	builderRequire.resolve("app-builder-lib"),
);

test("pinned builder accepts the config and applies entitlements to helpers/native code", async () => {
	const { validateConfiguration } = appBuilderRequire(
		"./util/config/config.js",
	);
	const config = require("../electron-builder.config.cjs");
	await validateConfiguration(config);
	const mac = policy.appleSigningOptions(credentials, "darwin");
	await validateConfiguration({
		...config,
		forceCodeSigning: true,
		mac: { ...config.mac, ...mac },
	});
	const { MacTargetHelper } = appBuilderRequire("./mac/MacTargetHelper.js");
	const helper = new MacTargetHelper({
		resourceList: Promise.resolve([]),
		platformSpecificBuildOptions: mac,
	});
	const app = "/test/open-quake.app";
	const options = await helper.getOptionsForFile(app, false, mac);
	for (const path of [
		app,
		`${app}/Contents/Frameworks/open-quake Helper.app`,
		`${app}/Contents/Resources/app.asar.unpacked/node_modules/node-hid/hid.node`,
		`${app}/Contents/Resources/app.asar.unpacked/node_modules/koffi/koffi.node`,
		`${app}/Contents/Resources/app.asar.unpacked/out/native-media/MediaRemoteAdapter.framework`,
	]) {
		assert.equal(options(path).hardenedRuntime, true);
		assert.equal(options(path).entitlements, "build/entitlements.mac.plist");
	}
	const entitlements = await readFile(
		new URL("../build/entitlements.mac.plist", import.meta.url),
		"utf8",
	);
	assert.ok(entitlements.includes("com.apple.security.device.audio-input"));
	assert.ok(entitlements.includes("com.apple.security.cs.allow-jit"));
	assert.equal(
		entitlements.includes("com.apple.security.get-task-allow"),
		false,
	);
});

test("ordinary local and PR builds stay ad-hoc without credentials", () => {
	for (const env of [{}, { GITHUB_EVENT_NAME: "pull_request" }]) {
		assert.equal(policy.appleSigningRequired(env, "darwin"), false);
		assert.deepEqual(policy.appleSigningOptions(env, "darwin"), {
			identity: "-",
			hardenedRuntime: false,
			notarize: false,
		});
	}
	assert.throws(
		() =>
			policy.appleSigningOptions(
				{ ...credentials, GITHUB_EVENT_NAME: "pull_request" },
				"darwin",
			),
		/pull-request/,
	);
});

test("tag mac builds cannot opt out or silently skip missing notarization", () => {
	assert.equal(
		policy.appleSigningRequired(
			{ ...tag, OPEN_QUAKE_APPLE_SIGNING: "0" },
			"darwin",
		),
		true,
	);
	for (const env of [
		tag,
		{ ...tag, APPLE_TEAM_ID: policy.APPLE_TEAM },
		{ ...credentials, APPLE_ID: "incomplete" },
		{ ...credentials, APPLE_TEAM_ID: "WRONG" },
		{ ...credentials, APPLE_API_KEY: "unsupported-path" },
	]) {
		assert.throws(
			() => policy.appleSigningOptions(env, "darwin"),
			/Apple release signing:/,
		);
	}
});

test("signed local profiles and release Apple ID credentials select distribution policy", () => {
	const options = policy.appleSigningOptions(credentials, "darwin");
	assert.equal(options.identity, policy.APPLE_IDENTITY);
	assert.equal(options.type, "distribution");
	assert.equal(options.hardenedRuntime, true);
	assert.equal(options.notarize, true);
	assert.equal(options.strictVerify, true);
	const ci = {
		...tag,
		GITHUB_ACTIONS: "true",
		APPLE_TEAM_ID: policy.APPLE_TEAM,
		APPLE_ID: "test@example.invalid",
		APPLE_APP_SPECIFIC_PASSWORD: "test-only",
		CSC_LINK: "test-only",
		CSC_KEY_PASSWORD: "test-only",
		APP_BUILDER_TMP_DIR: "/test-only",
	};
	assert.deepEqual(policy.appleSigningOptions(ci, "darwin"), options);
	for (const key of [
		"CSC_LINK",
		"CSC_KEY_PASSWORD",
		"APP_BUILDER_TMP_DIR",
		"APPLE_APP_SPECIFIC_PASSWORD",
	]) {
		assert.throws(
			() => policy.appleSigningOptions({ ...ci, [key]: "" }, "darwin"),
			/Apple release signing:/,
		);
	}
});

test("existing API credentials select the same policy and reject incomplete or mixed modes", () => {
	const api = {
		...tag,
		APPLE_TEAM_ID: policy.APPLE_TEAM,
		APPLE_API_KEY: "/test/notarization.p8",
		APPLE_API_KEY_ID: "TESTKEY123",
		APPLE_API_ISSUER: "00000000-0000-0000-0000-000000000000",
	};
	assert.deepEqual(
		policy.appleSigningOptions(api, "darwin"),
		policy.appleSigningOptions(credentials, "darwin"),
	);
	for (const key of ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"]) {
		assert.throws(
			() => policy.appleSigningOptions({ ...api, [key]: "" }, "darwin"),
			/Apple release signing:/,
		);
	}
	for (const extra of [
		{ APPLE_KEYCHAIN_PROFILE: "other-profile" },
		{
			APPLE_ID: "test@example.invalid",
			APPLE_APP_SPECIFIC_PASSWORD: "test-only",
		},
	]) {
		assert.throws(
			() => policy.appleSigningOptions({ ...api, ...extra }, "darwin"),
			/Apple release signing:/,
		);
	}
});

test("Windows and Linux never require Apple credentials, including on tags", () => {
	for (const platform of ["win32", "linux"]) {
		assert.equal(
			policy.appleSigningRequired({ ...tag, ...credentials }, platform),
			false,
		);
		assert.equal(policy.appleSigningOptions(tag, platform).notarize, false);
	}
});

test("real builder config fails closed for mac tags and keeps ordinary config usable", () => {
	const configPath = new URL("../electron-builder.config.cjs", import.meta.url);
	const config = (env) =>
		JSON.parse(
			execFileSync(
				process.execPath,
				[
					"-e",
					`console.log(JSON.stringify(require(${JSON.stringify(fileURLToPath(configPath))})))`,
				],
				{
					env: { PATH: process.env.PATH, ...env },
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				},
			),
		);
	assert.equal(config({}).forceCodeSigning, false);
	if (process.platform === "darwin") {
		assert.throws(() => config(tag));
		const signed = config({ ...tag, ...credentials });
		assert.equal(signed.forceCodeSigning, true);
		assert.equal(signed.mac.notarize, true);
		assert.deepEqual(signed.win, config({}).win);
		assert.deepEqual(signed.linux, config({}).linux);
	}
});

test("verification rejects ad-hoc, wrong team, missing runtime/timestamp and failed ticket/assessment", async () => {
	const valid = `Authority=Developer ID Application: ${policy.APPLE_IDENTITY}\nTeamIdentifier=${policy.APPLE_TEAM}\nCodeDirectory v=20500 flags=0x10000(runtime)\nTimestamp=Oct 27, 2026\n`;
	for (const stderr of [
		"Signature=adhoc\n",
		valid.replace(policy.APPLE_TEAM, "WRONG"),
		valid.replace("runtime", "none"),
		valid.replace(/^Timestamp=.+\n/m, ""),
	]) {
		await assert.rejects(verifyAppleApp("/test.app", async () => ({ stderr })));
	}
	for (const failure of ["codesign", "xcrun", "spctl"]) {
		await assert.rejects(
			verifyAppleApp("/test.app", async (tool) => {
				if (tool === failure) throw new Error("test command failed");
				return { stderr: valid };
			}),
		);
	}
	const calls = [];
	await verifyAppleApp("/test.app", async (tool, args) => {
		calls.push([tool, ...args]);
		return { stderr: valid };
	});
	assert.deepEqual(
		calls.map((call) => call[0]),
		["codesign", "codesign", "xcrun", "spctl"],
	);
	assert.deepEqual(calls[2], ["xcrun", "stapler", "validate", "/test.app"]);
});

test("release secrets are confined to the mac tag step and cleanup always follows", async () => {
	const { load } = appBuilderRequire("js-yaml");
	const workflow = load(
		await readFile(
			new URL(
				"../../../.github/workflows/desktop-release.yml",
				import.meta.url,
			),
			"utf8",
		),
	);
	const job = workflow.jobs.package;
	assert.equal(JSON.stringify(job.env).includes("secrets."), false);
	const signed = job.steps.find(
		(step) => step.name === "Sign and notarize macOS release",
	);
	assert.equal(
		signed.if,
		"github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') && matrix.platform == 'mac'",
	);
	const secretSteps = job.steps.filter((step) =>
		JSON.stringify(step).includes("secrets."),
	);
	assert.deepEqual(secretSteps, [signed]);
	assert.equal(signed.env.APPLE_API_KEY_P8, "${{ secrets.APPLE_API_KEY_P8 }}");
	assert.equal(signed.env.APPLE_ID, undefined);
	assert.ok(
		signed.run.includes('printf \'%s\' "$APPLE_API_KEY_P8" > "$APPLE_API_KEY"'),
	);
	assert.ok(signed.run.includes("unset APPLE_API_KEY_P8"));
	const unsigned = job.steps.find(
		(step) => step.name === "Package without distribution signing",
	);
	assert.equal(unsigned.if, `!(${signed.if})`);
	assert.equal(workflow.on.pull_request, null);
	assert.deepEqual(workflow.on.push.tags, ["v*"]);
	const cleanup = job.steps.find(
		(step) => step.name === "Clean temporary Apple signing material",
	);
	assert.equal(cleanup.if, `always() && ${signed.if}`);
	for (const step of [signed, cleanup]) {
		execFileSync("bash", ["-n"], { input: step.run });
	}
	assert.ok(job.steps.indexOf(cleanup) > job.steps.indexOf(signed));
	const smokeStep = job.steps.find((step) =>
		step.name?.startsWith("Smoke packaged Electron"),
	);
	const collect = job.steps.find((step) => step.name === "Collect downloads");
	assert.ok(job.steps.indexOf(smokeStep) < job.steps.indexOf(collect));
	assert.equal(job.strategy.matrix.include.length, 5);
	assert.deepEqual(workflow.jobs.publish.needs, ["validate", "verify-assets"]);
	const smoke = await readFile(
		new URL("./smoke-package.mjs", import.meta.url),
		"utf8",
	);
	assert.equal((smoke.match(/await verifyAppleApp\(/g) || []).length, 2);
});
