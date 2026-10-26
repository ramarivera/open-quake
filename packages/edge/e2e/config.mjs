import { randomBytes } from "node:crypto";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";

export const HERMES_COMMIT = "e10934b03e115b036b3c38b9c6e6817039a5962d";
// Docker Desktop on Windows has no POSIX host IDs. Its Linux bind mounts use
// the runtime's conventional user; Unix hosts preserve the snapshot owner.
export function containerIdentity(host = process) {
	return {
		uid: String(host.getuid?.() ?? 1000),
		gid: String(host.getgid?.() ?? 1000),
	};
}
export function settings(env, args = []) {
	if (
		[
			"OPEN_QUAKE_E2E_BASE_URL",
			"OPEN_QUAKE_E2E_API_KEY",
			"OPEN_QUAKE_E2E_MODEL",
		].some((key) => Object.hasOwn(env, key))
	)
		throw new Error(
			"Generic provider environment configuration is unsupported; select a saved production model",
		);
	const { values } = parseArgs({
		args,
		options: {
			"user-data": { type: "string" },
			"model-row": { type: "string" },
			scope: { type: "string" },
			"authorize-model": { type: "string" },
		},
	});
	if (
		!values["user-data"] ||
		!isAbsolute(values["user-data"]) ||
		!values["model-row"]?.trim() ||
		!values.scope?.trim() ||
		!values["authorize-model"]?.trim() ||
		values["authorize-model"].length > 256
	)
		throw new Error(
			"Specify absolute --user-data, --model-row, --scope and --authorize-model for the saved production model",
		);
	if (!env.OPEN_QUAKE_E2E_SCRATCH || !isAbsolute(env.OPEN_QUAKE_E2E_SCRATCH))
		throw new Error(
			"Set OPEN_QUAKE_E2E_SCRATCH to an absolute directory outside the repository",
		);
	return {
		userData: values["user-data"],
		rowId: values["model-row"],
		scope: values.scope,
		authorizedModel: values["authorize-model"],
		project: `oq-e2e-${randomBytes(8).toString("hex")}`,
		token: randomBytes(32).toString("hex"),
		scratch: env.OPEN_QUAKE_E2E_SCRATCH,
	};
}

/** Validate the native reader's snapshot without accepting caller provider overrides. */
export function validateSnapshot(snapshot, authorizedModel) {
	if (
		!snapshot ||
		snapshot.model !== authorizedModel ||
		typeof snapshot.apiKey !== "string" ||
		!snapshot.apiKey.trim() ||
		typeof snapshot.baseURL !== "string"
	)
		throw new Error("Saved production profile or credential is unavailable");
	if (!URL.canParse(snapshot.baseURL))
		throw new Error("Saved provider URL is invalid");
	const url = new URL(snapshot.baseURL);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error(
			"Saved provider URL must use HTTP(S) without inline credentials, query or fragment",
		);
	if (
		url.hostname === "localhost" ||
		url.hostname.endsWith(".localhost") ||
		url.hostname.startsWith("127.") ||
		["[::1]", "[::]", "0.0.0.0"].includes(url.hostname)
	)
		throw new Error(
			"Saved provider must be reachable from containers, not host loopback",
		);
}
