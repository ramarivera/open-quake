import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { HERMES_COMMIT, settings } from "./config.mjs";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");
const config = settings(process.env);
await mkdir(config.scratch, { recursive: true });
const scratch = await realpath(config.scratch);
const inside = relative(repository, scratch);
if (!inside.startsWith("..") && !inside.startsWith("/"))
	throw new Error("E2E scratch must be outside the repository");
const state = await mkdtemp(join(scratch, "runtime-e2e-"));
const env = {
	...process.env,
	OPEN_QUAKE_E2E_BASE_URL: config.baseURL,
	OPEN_QUAKE_E2E_MODEL: config.model,
	OPEN_QUAKE_E2E_API_KEY: config.apiKey,
	OPEN_QUAKE_E2E_RUNTIME_TOKEN: config.token,
	OPEN_QUAKE_E2E_HERMES_SOURCE: join(state, "hermes"),
	OPEN_QUAKE_E2E_HERMES_DOCKERFILE: join(here, "hermes.Dockerfile"),
};
const composeArgs = [
	"compose",
	"--project-name",
	config.project,
	"--file",
	join(here, "compose.yaml"),
];
const operationAbort = new AbortController();
let cleaningUp = false;
const redact = (value) => {
	let result = String(value);
	for (const secret of [config.apiKey, config.token, config.baseURL])
		if (secret) result = result.replaceAll(secret, "[redacted]");
	return result;
};
async function command(binary, args, timeout = 120000) {
	try {
		return await exec(binary, args, {
			env,
			timeout,
			signal: cleaningUp ? undefined : operationAbort.signal,
			maxBuffer: 8 * 1024 * 1024,
		});
	} catch (error) {
		await writeFile(
			join(scratch, `${config.project}-failure.log`),
			redact(`${error.stdout ?? ""}\n${error.stderr ?? ""}`),
			{ mode: 0o600 },
		);
		throw new Error(
			`${binary} failed; sanitized diagnostics: ${config.project}-failure.log`,
		);
	}
}
const compose = (args, timeout) =>
	command("docker", [...composeArgs, ...args], timeout);
const sleep = (ms) =>
	new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
async function endpoint(service, port) {
	const { stdout } = await compose(["port", service, String(port)]);
	const address = stdout.trim();
	if (!/^127\.0\.0\.1:\d+$/.test(address))
		throw new Error("Runtime API wasn't bound to loopback");
	return `http://${address}`;
}
async function ready(baseURL, path) {
	const deadline = Date.now() + 120000;
	while (Date.now() < deadline) {
		if (interrupted) abort();
		try {
			const response = await fetch(`${baseURL}${path}`, {
				headers: { Authorization: `Bearer ${config.token}` },
				redirect: "error",
				signal: AbortSignal.any([
					AbortSignal.timeout(3000),
					operationAbort.signal,
				]),
			});
			await response.body?.cancel();
			if (response.ok) return;
		} catch {
			/* startup is bounded by the deadline */
		}
		const { stdout } = await compose(["ps", "--all", "--format", "json"]);
		const rows = stdout
			.trim()
			.split("\n")
			.filter(Boolean)
			.flatMap((line) => JSON.parse(line));
		if (rows.some((row) => row.State === "exited" || row.State === "dead"))
			throw new Error("A runtime exited before readiness");
		await sleep(500);
	}
	throw new Error("Runtime readiness deadline exceeded");
}
const abort = () => {
	throw new Error("E2E interrupted");
};
// Abort active operations promptly; cleanup gets its own bounded commands.
let interrupted = false;
const onSignal = () => {
	interrupted = true;
	operationAbort.abort();
};
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);
let passed = false;
let failure;
try {
	console.log("Preparing pinned Hermes source and disposable Compose project");
	await command(
		"git",
		[
			"clone",
			"--quiet",
			"--filter=blob:none",
			"--no-checkout",
			"https://github.com/NousResearch/hermes-agent.git",
			env.OPEN_QUAKE_E2E_HERMES_SOURCE,
		],
		180000,
	);
	await command("git", [
		"-C",
		env.OPEN_QUAKE_E2E_HERMES_SOURCE,
		"checkout",
		"--quiet",
		"--detach",
		HERMES_COMMIT,
	]);
	if (interrupted) abort();
	await compose(["build", "hermes"], 900000);
	if (interrupted) abort();
	await compose(["up", "--detach", "--no-build"], 180000);
	const openclaw = await endpoint("openclaw", 18789);
	const hermes = await endpoint("hermes", 8642);
	console.log("Waiting for authenticated runtime readiness");
	await Promise.all([
		ready(openclaw, "/v1/models"),
		ready(hermes, "/v1/capabilities"),
	]);
	if (interrupted) abort();
	if (process.env.OPEN_QUAKE_E2E_FORCE_FAILURE === "1")
		throw new Error("Requested teardown failure probe");
	env.OPEN_QUAKE_E2E_OPENCLAW_URL = openclaw;
	env.OPEN_QUAKE_E2E_HERMES_URL = hermes;
	env.OPEN_QUAKE_E2E_RUN = "1";
	console.log(
		"Testing real runtime adapters, inference streams and session continuity",
	);
	const { stdout } = await command(
		"pnpm",
		[
			"--filter",
			"@open-quake/edge",
			"exec",
			"vitest",
			"run",
			"src/agent-http/container-e2e.test.ts",
			"--maxWorkers=1",
			"--no-file-parallelism",
		],
		600000,
	);
	console.log(redact(stdout));
	if (interrupted) abort();
	passed = true;
} catch (error) {
	failure = error;
	cleaningUp = true;
	try {
		const logs = await compose(["logs", "--no-color", "--tail", "80"], 15000);
		await writeFile(
			join(scratch, `${config.project}-runtime.log`),
			redact(logs.stdout + logs.stderr),
			{ mode: 0o600 },
		);
	} catch {
		/* original failure and teardown are still retained */
	}
} finally {
	cleaningUp = true;
	try {
		await compose(["down", "--volumes", "--remove-orphans"], 60000);
		const { stdout } = await command("docker", [
			"ps",
			"-aq",
			"--filter",
			`label=com.docker.compose.project=${config.project}`,
		]);
		const networks = await command("docker", [
			"network",
			"ls",
			"-q",
			"--filter",
			`label=com.docker.compose.project=${config.project}`,
		]);
		if (stdout.trim() || networks.stdout.trim()) {
			failure = new AggregateError(
				[failure, new Error("Compose resources survived cleanup")].filter(
					Boolean,
				),
				"E2E cleanup failed",
			);
		}
		console.log(
			`Compose cleanup verified; inference tests ${passed ? "passed" : "did not pass"}`,
		);
	} catch (error) {
		failure = new AggregateError(
			[failure, error].filter(Boolean),
			"E2E cleanup failed",
		);
	} finally {
		await rm(state, { recursive: true, force: true });
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
	}
}
if (failure) throw failure;
