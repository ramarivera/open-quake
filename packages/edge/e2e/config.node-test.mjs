import assert from "node:assert/strict";
import { test } from "node:test";
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
