import { randomBytes } from "node:crypto";

export const HERMES_COMMIT = "e10934b03e115b036b3c38b9c6e6817039a5962d";
export function settings(env) {
	const baseURL = env.OPEN_QUAKE_E2E_BASE_URL;
	const model = env.OPEN_QUAKE_E2E_MODEL;
	if (!baseURL || !model)
		throw new Error(
			"Set OPEN_QUAKE_E2E_BASE_URL and OPEN_QUAKE_E2E_MODEL explicitly",
		);
	const url = new URL(baseURL);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		throw new Error(
			"Use an HTTP(S) provider base URL without credentials, query or fragment",
		);
	if (
		url.hostname === "localhost" ||
		url.hostname.endsWith(".localhost") ||
		url.hostname.startsWith("127.") ||
		["[::1]", "[::]", "0.0.0.0"].includes(url.hostname)
	)
		throw new Error(
			"Provider URL must be reachable from containers; use a network address or host.docker.internal where supported, not host loopback",
		);
	if (!model.trim() || model.length > 256) throw new Error("Invalid E2E model");
	if (!env.OPEN_QUAKE_E2E_SCRATCH)
		throw new Error("Set OPEN_QUAKE_E2E_SCRATCH outside the repository");
	return {
		baseURL: url.href,
		model,
		apiKey: env.OPEN_QUAKE_E2E_API_KEY ?? "",
		project: `oq-e2e-${randomBytes(8).toString("hex")}`,
		token: randomBytes(32).toString("hex"),
		scratch: env.OPEN_QUAKE_E2E_SCRATCH,
	};
}
