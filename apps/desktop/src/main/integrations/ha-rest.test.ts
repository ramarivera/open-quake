import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { HaCertificateRejected } from "../../../../../packages/edge/src/channels/integration-errors";
import { openHaRest } from "./ha-rest";

const scratch =
	"/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-parity/management-center";
const servers: (http.Server | https.Server)[] = [];
const directories: string[] = [];
afterAll(async () => {
	await Promise.all(
		servers.map(
			(server) => new Promise<void>((resolve) => server.close(() => resolve())),
		),
	);
	for (const path of directories)
		rmSync(path, { recursive: true, force: true });
});
async function origin(server: http.Server | https.Server, scheme: string) {
	servers.push(server);
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	if (!address || typeof address === "string")
		throw new TypeError("Missing address");
	return `${scheme}://127.0.0.1:${address.port}`;
}
const handler =
	(calls: string[], auth: string): http.RequestListener =>
	(request, response) => {
		calls.push(request.url ?? "");
		if (request.headers.authorization !== auth) {
			response.writeHead(401);
			response.end("{}");
			return;
		}
		response.setHeader("Content-Type", "application/json");
		switch (request.url) {
			case "/api/":
				response.end('{"message":"API running"}');
				break;
			case "/api/states":
				response.end(
					'[{"entity_id":"light.desk","state":"on","attributes":{"friendly_name":"Desk"}}]',
				);
				break;
			case "/api/template":
				response.end('[{"entity_id":"light.desk","area":"Study"}]');
				break;
			case "/api/services":
				response.end(
					'[{"domain":"light","services":{"turn_on":{"name":"Turn on","fields":{"brightness":{"required":true,"selector":{"number":{"min":0,"max":255}}},"effect":{"selector":{"select":{"options":[{"value":"rainbow","label":"Rainbow"}]}}}}}}}]',
				);
				break;
			case "/api/states/light.desk":
				response.end(
					'{"entity_id":"light.desk","state":"off","attributes":{}}',
				);
				break;
			case "/api/services/light/turn_on":
				response.end("[]");
				break;
			default:
				response.writeHead(404);
				response.end("{}");
		}
	};
async function certificate() {
	await mkdir(scratch, { recursive: true });
	const directory = mkdtempSync(join(scratch, "ha-tls-"));
	directories.push(directory);
	execFileSync(
		"openssl",
		[
			"req",
			"-x509",
			"-newkey",
			"rsa:2048",
			"-nodes",
			"-keyout",
			join(directory, "key.pem"),
			"-out",
			join(directory, "cert.pem"),
			"-days",
			"1",
			"-subj",
			"/CN=localhost",
		],
		{ stdio: "ignore" },
	);
	return {
		key: readFileSync(join(directory, "key.pem")),
		cert: readFileSync(join(directory, "cert.pem")),
	};
}
describe("real HA HTTP/TLS sessions", () => {
	it("sends no request or bearer token to HTTP without explicit connection consent", async () => {
		const calls: string[] = [];
		const url = await origin(
			http.createServer(handler(calls, "Bearer synthetic-token")),
			"http",
		);
		await expect(openHaRest(url, "synthetic-token", [])).rejects.toMatchObject({
			code: "INTEGRATION.INPUT.REJECTED",
		});
		expect(calls).toEqual([]);
	});

	it("uses bearer headers, REST services, area metadata, scoped entity reads and closes the session", async () => {
		const calls: string[] = [];
		const url = await origin(
			http.createServer(handler(calls, "Bearer private-token")),
			"http",
		);
		const connection = await openHaRest(url, "private-token", [], true);
		expect(await connection.entities()).toMatchObject([
			{ entity_id: "light.desk", area: "Study", state: "on" },
		]);
		expect(await connection.services()).toMatchObject([
			{
				fields: [
					{ name: "brightness", type: "number", min: 0, max: 255 },
					{ name: "effect", type: "select", options: ["rainbow"] },
				],
			},
		]);
		expect(await connection.states(["light.desk"])).toMatchObject([
			{ state: "off" },
		]);
		await connection.execute("light", "turn_on", {
			entity_id: "light.desk",
			brightness: 12,
		});
		connection.close();
		await expect(connection.states(["light.desk"])).rejects.toMatchObject({
			code: "HA.NETWORK.FAILED",
		});
		expect(calls.some((path) => path.includes("private-token"))).toBe(false);
	});
	it("returns typed authentication failure", async () => {
		const url = await origin(
			http.createServer(handler([], "Bearer expected")),
			"http",
		);
		await expect(openHaRest(url, "wrong", [], true)).rejects.toMatchObject({
			code: "HA.AUTH.FAILED",
		});
	});
	it("withholds the token until certificate consent, rejects a changed certificate and isolates other origins", async () => {
		const material = await certificate();
		const calls: string[] = [];
		const url = await origin(
			https.createServer(material, handler(calls, "Bearer private-token")),
			"https",
		);
		let rejected: HaCertificateRejected | undefined;
		try {
			await openHaRest(url, "private-token", []);
		} catch (cause) {
			if (cause instanceof HaCertificateRejected) rejected = cause;
			else throw cause;
		}
		expect(rejected?.fingerprint).toMatch(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/);
		expect(calls).toEqual([]);
		if (!rejected) throw new TypeError("Missing TLS rejection");
		const trust = [{ origin: url, fingerprint: rejected.fingerprint }];
		const connection = await openHaRest(url, "private-token", trust);
		connection.close();
		expect(calls).toEqual(["/api/"]);
		const other = await origin(
			https.createServer(material, handler([], "Bearer private-token")),
			"https",
		);
		await expect(
			openHaRest(other, "private-token", trust),
		).rejects.toMatchObject({ code: "HA.CERTIFICATE.REJECTED", origin: other });
		const server = servers.find((candidate) => {
			const address = candidate.address();
			return (
				address !== null &&
				typeof address !== "string" &&
				`https://127.0.0.1:${address.port}` === url
			);
		});
		if (!(server instanceof https.Server))
			throw new TypeError("Missing TLS server");
		server.setSecureContext(await certificate());
		await expect(openHaRest(url, "private-token", trust)).rejects.toMatchObject(
			{ code: "HA.CERTIFICATE.REJECTED", origin: url },
		);
	});
});
