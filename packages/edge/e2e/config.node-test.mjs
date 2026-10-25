import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { settings } from "./config.mjs";

const input = {
	OPEN_QUAKE_E2E_BASE_URL: "https://example.invalid/custom/v1",
	OPEN_QUAKE_E2E_MODEL: "chosen-model",
	OPEN_QUAKE_E2E_SCRATCH: "/external/scratch",
};
test("requires explicit generic provider settings and an external scratch root", () => {
	assert.throws(() => settings({}));
	assert.throws(() => settings({ ...input, OPEN_QUAKE_E2E_SCRATCH: "" }));
	const result = settings({
		...input,
		OPEN_QUAKE_E2E_API_KEY: "test-provider-key",
	});
	assert.equal(result.baseURL, input.OPEN_QUAKE_E2E_BASE_URL);
	assert.equal(result.apiKey, "test-provider-key");
	assert.equal(result.model, "chosen-model");
	assert.notEqual(result.token, settings(input).token);
	assert.notEqual(result.project, settings(input).project);
});
test("rejects inline credentials and non-HTTP provider locations", () => {
	for (const url of [
		"file:///etc/passwd",
		"https://user:secret@example.invalid/v1",
		"https://example.invalid/v1?key=secret",
		"https://example.invalid/v1#secret",
	])
		assert.throws(() => settings({ ...input, OPEN_QUAKE_E2E_BASE_URL: url }));
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
				settings({
					...input,
					OPEN_QUAKE_E2E_BASE_URL: `http://${host}:8000/v1`,
				}),
			/reachable from containers/,
		);
	assert.equal(
		settings({
			...input,
			OPEN_QUAKE_E2E_BASE_URL: "http://host.docker.internal:8000/v1",
		}).baseURL,
		"http://host.docker.internal:8000/v1",
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
						env: { ...input, OPEN_QUAKE_E2E_API_KEY: "fixture-key" },
						on: () => {},
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
			assert.equal(
				saved.models.providers.e2e.baseUrl,
				input.OPEN_QUAKE_E2E_BASE_URL,
			);
		}
	}
});
