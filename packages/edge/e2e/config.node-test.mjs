import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { containerIdentity, settings, validateSnapshot } from "./config.mjs";

test("container identity preserves the private snapshot owner on Unix hosts", () => {
	assert.deepEqual(containerIdentity({ getuid: () => 501, getgid: () => 20 }), {
		uid: "501",
		gid: "20",
	});
	assert.deepEqual(
		containerIdentity({ getuid: () => 1000, getgid: () => 1001 }),
		{ uid: "1000", gid: "1001" },
	);
	assert.deepEqual(containerIdentity({}), { uid: "1000", gid: "1000" });
});

const input = {
	OPEN_QUAKE_E2E_SCRATCH: "/external/scratch",
};
const args = [
	"--user-data",
	"/saved/app",
	"--model-row",
	"selected-row",
	"--scope",
	"default",
	"--authorize-model",
	"chosen-model",
];
const snapshot = {
	baseURL: "https://example.invalid/custom/v1",
	model: "chosen-model",
	apiKey: "fixture-key",
};
test("requires explicit saved production selection and an external scratch root", () => {
	assert.throws(() => settings({}));
	assert.throws(() => settings(input));
	assert.throws(() => settings({ ...input, OPEN_QUAKE_E2E_SCRATCH: "" }, args));
	assert.throws(() => settings(input, args.slice(0, 4)));
	assert.throws(() =>
		settings(
			input,
			args.filter((value) => !["--scope", "default"].includes(value)),
		),
	);
	const result = settings(input, args);
	assert.equal(result.rowId, "selected-row");
	assert.equal(result.authorizedModel, "chosen-model");
	assert.equal(result.userData, "/saved/app");
	assert.equal(result.scope, "default");
	assert.equal("apiKey" in result, false);
	assert.equal("baseURL" in result, false);
	assert.notEqual(result.token, settings(input, args).token);
	assert.notEqual(result.project, settings(input, args).project);
});
test("rejects every legacy provider environment override without exposing values", () => {
	for (const key of [
		"OPEN_QUAKE_E2E_BASE_URL",
		"OPEN_QUAKE_E2E_API_KEY",
		"OPEN_QUAKE_E2E_MODEL",
	]) {
		assert.throws(
			() => settings({ ...input, [key]: "" }, args),
			/Generic provider/,
		);
		assert.throws(
			() => settings({ ...input, [key]: "private-value" }, args),
			(error) =>
				error.message.includes("Generic provider") &&
				!error.message.includes("private-value"),
		);
	}
});
test("native snapshot must retain the authorized model and a resolved credential", () => {
	assert.doesNotThrow(() => validateSnapshot(snapshot, "chosen-model"));
	for (const change of [
		{ model: "different" },
		{ apiKey: "" },
		{ apiKey: null },
		{ baseURL: null },
	])
		assert.throws(() =>
			validateSnapshot({ ...snapshot, ...change }, "chosen-model"),
		);
});
test("rejects inline credentials and non-HTTP provider locations", () => {
	for (const url of [
		"file:///etc/passwd",
		"https://user:secret@example.invalid/v1",
		"https://example.invalid/v1?key=secret",
		"https://example.invalid/v1#secret",
	])
		assert.throws(() =>
			validateSnapshot({ ...snapshot, baseURL: url }, "chosen-model"),
		);
});

test("rejects host loopback providers before starting unreachable container requests", () => {
	for (const host of [
		"localhost",
		"service.localhost",
		"127.0.0.1",
		"127.1",
		"[::1]",
		"[::]",
		"0.0.0.0",
	])
		assert.throws(
			() =>
				validateSnapshot(
					{ ...snapshot, baseURL: `http://${host}:8000/v1` },
					"chosen-model",
				),
			/reachable from containers/,
		);
	assert.doesNotThrow(() =>
		validateSnapshot(
			{ ...snapshot, baseURL: "http://host.docker.internal:8000/v1" },
			"chosen-model",
		),
	);
});

test("OpenClaw bootstrap requires denied tools before writing config or starting runtime", () => {
	const source = readFileSync(
		new URL("./openclaw.mjs", import.meta.url),
		"utf8",
	).replace(/^import .*;\n/gm, "");
	for (const toolsEnabled of [false, true]) {
		let started = false;
		let saved;
		const run = () =>
			runInNewContext(
				toolsEnabled ? source.replace('tools: { deny: ["*"] },', "") : source,
				{
					assert,
					process: {
						env: input,
						on: () => {},
					},
					readFileSync: (path) => {
						assert.equal(path, "/run/secrets/production_provider");
						return JSON.stringify(snapshot);
					},
					writeFileSync: (_path, json) => {
						saved = JSON.parse(json);
					},
					spawn: () => {
						started = true;
						return { on: () => {} };
					},
				},
			);
		if (toolsEnabled) {
			assert.throws(run, /E2E requires all tools denied/);
			assert.equal(saved, undefined);
			assert.equal(started, false);
		} else {
			run();
			assert.equal(started, true);
			assert.equal(saved.models.providers.e2e.apiKey, "fixture-key");
			assert.equal(saved.models.providers.e2e.baseUrl, snapshot.baseURL);
		}
	}
});
