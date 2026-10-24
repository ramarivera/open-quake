import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { realpath } from "node:fs/promises";
import * as http from "node:http";
import * as https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { HaCertificateRejected } from "../../../../../packages/edge/src/channels/integration-errors";
import { EMPTY_HA_STORE } from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import {
	HaPorts,
	HomeAssistantService,
} from "../../../../../packages/edge/src/home-assistant/ha-service";
import { decodeHaServices, openHaRest } from "./ha-rest";
import { groupedServices } from "./review-grouped-services";
import { fakeVault, memoryStore } from "./test-fixtures";

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
	const directory = mkdtempSync(join(await realpath(tmpdir()), "ha-tls-"));
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
	it("isolates missing entity states without disconnecting healthy polling or actions", async () => {
		const calls: string[] = [];
		let failure = 404;
		const normal = handler(calls, "Bearer synthetic-token");
		const url = await origin(
			http.createServer((request, response) => {
				if (request.url === "/api/states/light.missing") {
					response.writeHead(failure);
					response.end("{}");
				} else normal(request, response);
			}),
			"http",
		);
		const runtime = ManagedRuntime.make(
			HomeAssistantService.Default.pipe(
				Layer.provide(
					Layer.succeed(HaPorts, {
						store: memoryStore(EMPTY_HA_STORE).port,
						vault: fakeVault().port,
						open: openHaRest,
						place: async () => {},
					}),
				),
			),
		);
		try {
			await runtime.runPromise(
				HomeAssistantService.connect(url, "synthetic-token", true),
			);
			await runtime.runPromise(
				HomeAssistantService.setVisible(["light.missing", "light.desk"]),
			);
			const live = await runtime.runPromise(HomeAssistantService.poll());
			expect(live).toMatchObject({
				connected: true,
				states: [
					{ entity_id: "light.missing", state: "unavailable", attributes: {} },
					{ entity_id: "light.desk", state: "off", area: "Study" },
				],
			});
			expect(
				(await runtime.runPromise(HomeAssistantService.snapshot())).state,
			).toBe("Connected");
			await runtime.runPromise(
				HomeAssistantService.execute(
					{
						entity_id: "light.desk",
						service: "turn_on",
						service_data: { brightness: 12 },
						custom_display_type: "default",
						custom_display_settings: { fontSize: 40 },
						custom_display_detail: [],
					},
					false,
				),
			);
			expect(calls).toContain("/api/services/light/turn_on");
			failure = 500;
			expect(
				await runtime.runPromise(HomeAssistantService.poll().pipe(Effect.flip)),
			).toMatchObject({ code: "HA.NETWORK.FAILED" });
			expect(
				(await runtime.runPromise(HomeAssistantService.snapshot())).state,
			).toBe("Failed");
		} finally {
			await runtime.runPromise(HomeAssistantService.dispose());
			await runtime.dispose();
		}
	});

	it("does not treat authentication failures on a state endpoint as a missing entity", async () => {
		const normal = handler([], "Bearer synthetic-token");
		const url = await origin(
			http.createServer((request, response) => {
				if (request.url === "/api/states/light.denied") {
					response.writeHead(403);
					response.end("{}");
				} else normal(request, response);
			}),
			"http",
		);
		const connection = await openHaRest(url, "synthetic-token", [], true);
		try {
			await expect(
				connection.states(["light.desk", "light.denied"]),
			).rejects.toMatchObject({ code: "HA.AUTH.FAILED" });
			await expect(
				connection.execute("missing", "service", {}),
			).rejects.toMatchObject({ code: "HA.NETWORK.FAILED" });
		} finally {
			connection.close();
		}
	});
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

it("flattens service sections into leaf controls with unchanged validation metadata", () => {
	const catalog = decodeHaServices(groupedServices);
	expect(catalog[0]?.fields.map((field) => field.name)).toEqual([
		"brightness",
		"transition",
		"effect",
	]);
	expect(
		catalog[0]?.fields.find((field) => field.name === "transition"),
	).toMatchObject({
		required: true,
		type: "number",
		min: 0,
		max: 60,
		label: "Transition",
	});
	expect(
		catalog[0]?.fields.find((field) => field.name === "effect"),
	).toMatchObject({ type: "select", options: ["rainbow", "pulse"] });
});

it("submits flattened grouped leaf data through the service and the real REST connection", async () => {
	const outbound: unknown[] = [];
	const normal = handler([], "Bearer synthetic-token");
	const url = await origin(
		http.createServer((request, response) => {
			if (request.url === "/api/services") {
				response.setHeader("Content-Type", "application/json");
				response.end(JSON.stringify(groupedServices));
			} else if (request.url === "/api/services/light/turn_on") {
				let data = "";
				request.on("data", (chunk: Buffer) => {
					data += chunk.toString("utf8");
				});
				request.on("end", () => {
					outbound.push(JSON.parse(data));
					response.end("[]");
				});
			} else normal(request, response);
		}),
		"http",
	);
	const placed: unknown[] = [];
	const runtime = ManagedRuntime.make(
		HomeAssistantService.Default.pipe(
			Layer.provide(
				Layer.succeed(HaPorts, {
					store: memoryStore(EMPTY_HA_STORE).port,
					vault: fakeVault().port,
					open: openHaRest,
					place: async (_target, key) => {
						placed.push(key);
					},
				}),
			),
		),
	);
	try {
		await runtime.runPromise(
			HomeAssistantService.connect(url, "synthetic-token", true),
		);
		const key = {
			entity_id: "light.desk",
			service: "turn_on",
			service_data: { brightness: 12, transition: 7, effect: "pulse" },
			custom_display_type: "default",
			custom_display_settings: { fontSize: 40 },
			custom_display_detail: [],
		} as const;
		await runtime.runPromise(
			HomeAssistantService.saveKey(
				{ profileId: "p", pageId: "page", keyCode: "1,1" },
				key,
			),
		);
		expect(placed).toEqual([key]);
		await runtime.runPromise(HomeAssistantService.execute(key));
		expect(outbound).toEqual([
			{
				entity_id: "light.desk",
				brightness: 12,
				transition: 7,
				effect: "pulse",
			},
		]);
		const invalid = await runtime.runPromise(
			HomeAssistantService.execute({
				...key,
				service_data: { brightness: 12, transition: 61 },
			}).pipe(Effect.either),
		);
		expect(invalid._tag === "Left" && invalid.left).toMatchObject({
			code: "INTEGRATION.INPUT.REJECTED",
			field: "transition",
		});
		expect(outbound).toHaveLength(1);
	} finally {
		await runtime.runPromise(HomeAssistantService.dispose());
		await runtime.dispose();
	}
});
