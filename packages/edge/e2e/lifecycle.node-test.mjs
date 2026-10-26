import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupProject, failureDiagnostic } from "./lifecycle.mjs";

function fixture({
	downFails = false,
	inventoryFails = false,
	residual = -1,
} = {}) {
	const calls = [];
	let removed = false;
	let secretsRemoved = false;
	return {
		calls,
		removed: () => removed,
		secretsRemoved: () => secretsRemoved,
		options: {
			project: "oq-e2e-test",
			compose: async (args) => {
				calls.push(args);
				if (downFails) throw new Error("Docker unavailable");
			},
			command: async (binary, args) => {
				const index = calls.length - 1;
				calls.push([binary, ...args]);
				if (inventoryFails) throw new Error("Cannot enumerate Docker");
				return { stdout: index === residual ? "remaining-resource\n" : "" };
			},
			removeState: async () => {
				removed = true;
			},
			removeSecrets: async () => {
				secretsRemoved = true;
			},
		},
	};
}

test("failed teardown preserves recovery state", async () => {
	const f = fixture({ downFails: true });
	await assert.rejects(cleanupProject(f.options), /Docker unavailable/);
	assert.equal(f.removed(), false);
	assert.equal(f.secretsRemoved(), true);
	assert.equal(f.calls.length, 1);
});

test("residual containers, networks or volumes preserve state and fail cleanup", async () => {
	for (const residual of [0, 1, 2]) {
		const f = fixture({ residual });
		await assert.rejects(cleanupProject(f.options), /resources survived/);
		assert.equal(f.removed(), false);
		assert.equal(f.secretsRemoved(), true);
	}
});

test("inventory failure preserves recovery state", async () => {
	const f = fixture({ inventoryFails: true });
	await assert.rejects(cleanupProject(f.options), /Cannot enumerate/);
	assert.equal(f.removed(), false);
	assert.equal(f.secretsRemoved(), true);
});

test("removes state only after successful down and three empty inventories", async () => {
	const f = fixture();
	await cleanupProject(f.options);
	assert.equal(f.removed(), true);
	assert.equal(f.secretsRemoved(), true);
	assert.deepEqual(f.calls, [
		["down", "--volumes", "--remove-orphans"],
		[
			"docker",
			"ps",
			"-aq",
			"--filter",
			"label=com.docker.compose.project=oq-e2e-test",
		],
		[
			"docker",
			"network",
			"ls",
			"-q",
			"--filter",
			"label=com.docker.compose.project=oq-e2e-test",
		],
		[
			"docker",
			"volume",
			"ls",
			"-q",
			"--filter",
			"label=com.docker.compose.project=oq-e2e-test",
		],
	]);
});

test("diagnostics exclude all arbitrary command output and error messages", () => {
	const secret = 'key+/sensitive="';
	const payload = [
		secret,
		encodeURIComponent(secret),
		Buffer.from(secret).toString("base64"),
		JSON.stringify(secret),
	].join("\n");
	const result = failureDiagnostic("docker", {
		code: 1,
		signal: "SIGTERM",
		stdout: payload,
		stderr: payload,
		message: payload,
	});
	assert.deepEqual(JSON.parse(result), {
		command: "docker",
		exitCode: 1,
		signal: "SIGTERM",
		outputOmitted: true,
	});
	assert.equal(
		failureDiagnostic("docker", { code: payload, signal: payload }).includes(
			secret,
		),
		false,
	);
});
