import { execFile } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	containerIdentity,
	HERMES_COMMIT,
	settings,
	validateSnapshot,
} from "./config.mjs";
import { cleanupProject, failureDiagnostic } from "./lifecycle.mjs";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");
const config = settings(process.env, process.argv.slice(2));
const identity = containerIdentity();
await mkdir(config.scratch, { recursive: true });
const scratch = await realpath(config.scratch);
const inside = relative(repository, scratch);
if (!inside.startsWith("..") && !inside.startsWith("/"))
	throw new Error("E2E scratch must be outside the repository");
const state = await mkdtemp(join(scratch, "runtime-e2e-"));
const profileDirectory = join(state, "private-profile");
await mkdir(profileDirectory, { mode: 0o700 });
console.log(`Disposable Compose project: ${config.project}`);
await writeFile(
	join(state, "cleanup.compose.json"),
	JSON.stringify({
		name: config.project,
		services: { openclaw: { image: "scratch" }, hermes: { image: "scratch" } },
	}),
	{ mode: 0o600 },
);
const env = {
	...process.env,
	OPEN_QUAKE_E2E_PROFILE_FILE: join(profileDirectory, "provider.json"),
	OPEN_QUAKE_E2E_RUNTIME_TOKEN: config.token,
	OPEN_QUAKE_E2E_REPORT_PREFIX: join(scratch, config.project),
	OPEN_QUAKE_E2E_HERMES_SOURCE: join(state, "hermes"),
	OPEN_QUAKE_E2E_HERMES_DOCKERFILE: join(here, "hermes.Dockerfile"),
	OPEN_QUAKE_E2E_RUN: "1",
	OPEN_QUAKE_E2E_UID: identity.uid,
	OPEN_QUAKE_E2E_GID: identity.gid,
};
// T3 may itself run inside Electron with this flag. Child acceptance must
// launch the real Electron application rather than Electron's Node mode.
delete env.ELECTRON_RUN_AS_NODE;
const composeArgs = [
	"compose",
	"--project-name",
	config.project,
	"--file",
	join(here, "compose.yaml"),
];
const operationAbort = new AbortController();
let cleaningUp = false;
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
			failureDiagnostic(binary, error),
			{ mode: 0o600 },
		);
		throw new Error(
			`${binary} failed; exit diagnostics: ${config.project}-failure.log`,
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
let composeStarted = false;
try {
	console.log(
		"Reading the explicitly selected saved model through production native credentials",
	);
	await command(
		"pnpm",
		[
			"--filter",
			"@open-quake/desktop",
			"exec",
			"electron-vite",
			"build",
			"--config",
			"src/main/test/runtime-profile-export.config.ts",
		],
		180000,
	);
	const profileRead = await command(
		"pnpm",
		[
			"--filter",
			"@open-quake/desktop",
			"exec",
			"electron",
			"out/runtime-profile/runtime-profile-export.js",
			"--user-data",
			config.userData,
			"--model-row",
			config.rowId,
			"--scope",
			config.scope,
			"--authorize-model",
			config.authorizedModel,
			"--output",
			profileDirectory,
		],
		30000,
	);
	if (!profileRead.stdout.includes("PRODUCTION_PROFILE_READ_OK"))
		throw new Error("Production profile reader did not complete");
	validateSnapshot(
		JSON.parse(await readFile(env.OPEN_QUAKE_E2E_PROFILE_FILE, "utf8")),
		config.authorizedModel,
	);
	// Keep the native reader's 0600 mode. Both containers run as this file's
	// owner, because file-backed Compose secrets preserve host permissions.
	if (interrupted) abort();
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
	composeStarted = true;
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
	await command(
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
	console.log("All three runtime inference and session tests passed");
	if (process.env.OPEN_QUAKE_E2E_DESKTOP === "1") {
		console.log(
			"Building and exercising the production desktop UI against both runtimes",
		);
		env.OPEN_QUAKE_MOCK_DEVICE = "1";
		await command("pnpm", ["--filter", "@open-quake/desktop", "build"], 180000);
		await command(
			"pnpm",
			[
				"--filter",
				"@open-quake/desktop",
				"exec",
				"electron-vite",
				"build",
				"--config",
				"src/main/test/runtime-desktop-e2e.config.ts",
			],
			180000,
		);
		const result = await command(
			"pnpm",
			[
				"--filter",
				"@open-quake/desktop",
				"exec",
				"electron",
				"out/agent-e2e/runtime-desktop-e2e.js",
			],
			300000,
		);
		if (!result.stdout.includes("DESKTOP_E2E_PASS production root and preload"))
			throw new Error(
				"Desktop acceptance did not produce its completion marker",
			);
		console.log(
			"Both production desktop selection, UI streaming and session tests passed",
		);
	}
	if (interrupted) abort();
	passed = true;
} catch (error) {
	failure = error;
} finally {
	cleaningUp = true;
	try {
		if (composeStarted)
			await cleanupProject({
				project: config.project,
				compose,
				command,
				removeState: () => rm(state, { recursive: true, force: true }),
				removeSecrets: () =>
					rm(profileDirectory, { recursive: true, force: true }),
			});
		else await rm(state, { recursive: true, force: true });
		console.log(
			`Compose cleanup verified; inference tests ${passed ? "passed" : "did not pass"}`,
		);
	} catch (error) {
		console.error(`Cleanup failed; recovery state retained at ${state}`);
		failure = new AggregateError(
			[failure, error].filter(Boolean),
			"E2E cleanup failed",
		);
	} finally {
		// Recovery state must never retain plaintext provider credentials,
		// including when Compose down or inventory verification fails.
		await rm(profileDirectory, { recursive: true, force: true });
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
	}
}
if (failure) throw failure;
