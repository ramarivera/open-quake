import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import * as tls from "node:tls";
import { Schema } from "effect";
import {
	HaAuthenticationFailed,
	HaCertificateRejected,
	HaNetworkFailed,
} from "../../../../../packages/edge/src/channels/integration-errors";
import {
	type Certificate,
	Entity,
	type HaConnection,
	type HaService,
	type Json,
	type ServiceField,
} from "../../../../../packages/edge/src/home-assistant/ha-contracts";

const RawField = Schema.Struct({
	name: Schema.optional(Schema.String),
	required: Schema.optional(Schema.Boolean),
	selector: Schema.optional(
		Schema.Record({ key: Schema.String, value: Schema.Unknown }),
	),
});
const RawServices = Schema.Array(
	Schema.Struct({
		domain: Schema.String,
		services: Schema.Record({
			key: Schema.String,
			value: Schema.Struct({
				name: Schema.optional(Schema.String),
				fields: Schema.optional(
					Schema.Record({ key: Schema.String, value: RawField }),
				),
			}),
		}),
	}),
);
const numberSelector = Schema.Struct({
	min: Schema.optional(Schema.Number),
	max: Schema.optional(Schema.Number),
});
const selectSelector = Schema.Struct({
	options: Schema.Array(
		Schema.Union(
			Schema.String,
			Schema.Struct({
				value: Schema.String,
				label: Schema.optional(Schema.String),
			}),
		),
	),
});
export function decodeHaServices(input: unknown): readonly HaService[] {
	return Schema.decodeUnknownSync(RawServices)(input).flatMap((group) =>
		Object.entries(group.services).map(([service, detail]) => ({
			domain: group.domain,
			service,
			name: detail.name ?? service,
			fields: Object.entries(detail.fields ?? {}).map(
				([name, f]): ServiceField => {
					const selector = f.selector ?? {};
					const number = Schema.decodeUnknownEither(numberSelector)(
						selector.number,
					);
					const select = Schema.decodeUnknownEither(selectSelector)(
						selector.select,
					);
					return {
						name,
						label: f.name ?? name,
						required: f.required ?? false,
						type:
							selector.number !== undefined
								? "number"
								: selector.boolean !== undefined
									? "boolean"
									: selector.select !== undefined
										? "select"
										: "text",
						min: number._tag === "Right" ? (number.right.min ?? 0) : 0,
						max:
							number._tag === "Right"
								? (number.right.max ?? Number.MAX_SAFE_INTEGER)
								: Number.MAX_SAFE_INTEGER,
						options:
							select._tag === "Right"
								? select.right.options.map((o) =>
										typeof o === "string" ? o : o.value,
									)
								: [],
					};
				},
			),
		})),
	);
}
/** A fresh Agent belongs to exactly one HA origin. It releases the socket only after verification. */
export function scopedHaAgent(
	origin: string,
	trust: readonly Certificate[],
): https.Agent {
	const url = new URL(origin);
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	const agent = new https.Agent({ keepAlive: false });
	agent.createConnection = (_options, callback) => {
		const socket = tls.connect({
			host: hostname,
			port: Number(url.port) || 443,
			rejectUnauthorized: false,
			...(isIP(hostname) ? {} : { servername: hostname }),
		});
		let completed = false;
		const done = (error: Error | null) => {
			if (completed) return;
			completed = true;
			socket.setTimeout(0);
			callback?.(error, socket);
			if (error) socket.destroy();
		};
		socket.setTimeout(10000, () => done(new HaNetworkFailed()));
		socket.once("error", (error) => done(error));
		socket.once("secureConnect", () => {
			const peer = socket.getPeerCertificate();
			const fingerprint = peer.fingerprint256 ?? "";
			const authorized =
				socket.authorized && !tls.checkServerIdentity(hostname, peer);
			const consent = trust.some(
				(t) => t.origin === origin && t.fingerprint === fingerprint,
			);
			done(
				authorized || consent
					? null
					: new HaCertificateRejected(
							socket.authorizationError,
							origin,
							fingerprint,
						),
			);
		});
		return undefined;
	};
	return agent;
}
export async function openHaRest(
	origin: string,
	token: string,
	trust: readonly Certificate[],
): Promise<HaConnection> {
	const base = new URL(origin);
	const agent =
		base.protocol === "https:"
			? scopedHaAgent(origin, trust)
			: new http.Agent({ keepAlive: false });
	const pending = new Set<http.ClientRequest>();
	let closed = false;
	const request = (
		path: string,
		body?: Readonly<Record<string, Json>>,
	): Promise<unknown> =>
		new Promise((resolve, reject) => {
			if (closed) {
				reject(new HaNetworkFailed());
				return;
			}
			const payload = body ? JSON.stringify(body) : undefined;
			const req = (base.protocol === "https:" ? https.request : http.request)(
				new URL(path, origin),
				{
					agent,
					method: payload ? "POST" : "GET",
					headers: {
						Authorization: `Bearer ${token}`,
						Accept: "application/json",
						...(payload
							? {
									"Content-Type": "application/json",
									"Content-Length": Buffer.byteLength(payload),
								}
							: {}),
					},
				},
				(response) => {
					if (response.statusCode === 401 || response.statusCode === 403) {
						response.resume();
						reject(new HaAuthenticationFailed());
						return;
					}
					if (
						!response.statusCode ||
						response.statusCode < 200 ||
						response.statusCode >= 300
					) {
						response.resume();
						reject(new HaNetworkFailed());
						return;
					}
					const buffers: Buffer[] = [];
					let size = 0;
					response.on("data", (chunk: Buffer) => {
						size += chunk.length;
						if (size > 4 * 1024 * 1024) {
							req.destroy(new HaNetworkFailed());
							return;
						}
						buffers.push(chunk);
					});
					response.once("error", reject);
					response.once("end", () => {
						try {
							const text = Buffer.concat(buffers).toString("utf8");
							resolve(text ? JSON.parse(text) : null);
						} catch (cause) {
							reject(new HaNetworkFailed(cause));
						}
					});
				},
			);
			pending.add(req);
			req.once("close", () => pending.delete(req));
			req.once("error", reject);
			req.setTimeout(10000, () => req.destroy(new HaNetworkFailed()));
			if (payload) req.write(payload);
			req.end();
		});
	const close = () => {
		closed = true;
		for (const req of pending) req.destroy();
		pending.clear();
		agent.destroy();
	};
	try {
		await request("/api/");
	} catch (cause) {
		close();
		throw cause;
	}
	const areas = async () =>
		Schema.decodeUnknownSync(
			Schema.Array(
				Schema.Struct({ entity_id: Schema.String, area: Schema.String }),
			),
		)(
			await request("/api/template", {
				template:
					'[{% for s in states %}{"entity_id":{{ s.entity_id | to_json }},"area":{{ (area_name(s.entity_id) or "Other") | to_json }}}{% if not loop.last %},{% endif %}{% endfor %}]',
			}),
		);
	let areaByEntity = new Map<string, string>();
	return {
		entities: async () => {
			const [raw, rooms] = await Promise.all([request("/api/states"), areas()]);
			areaByEntity = new Map(rooms.map((r) => [r.entity_id, r.area]));
			return Schema.decodeUnknownSync(Schema.Array(Entity))(raw).map((e) => ({
				...e,
				area: areaByEntity.get(e.entity_id) ?? "Other",
			}));
		},
		services: async () => decodeHaServices(await request("/api/services")),
		states: async (ids) =>
			Promise.all(
				ids.map(async (id) => {
					const entity = Schema.decodeUnknownSync(Entity)(
						await request(`/api/states/${encodeURIComponent(id)}`),
					);
					return { ...entity, area: areaByEntity.get(id) ?? "Other" };
				}),
			),
		execute: async (domain, service, data) => {
			await request(
				`/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
				data,
			);
		},
		close,
	};
}
