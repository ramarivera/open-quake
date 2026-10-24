import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { ChannelService } from "../../../../../packages/edge/src/channels/channel-service";
import {
	HaCertificateRejected,
	StoreFailed,
} from "../../../../../packages/edge/src/channels/integration-errors";
import type { HaKey } from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import { tileLines } from "../../../../../packages/edge/src/home-assistant/ha-invariants";
import { HomeAssistantService } from "../../../../../packages/edge/src/home-assistant/ha-service";
import {
	conflictIds,
	normalizeChord,
} from "../../../../../packages/edge/src/shortcuts/shortcut-invariants";
import { entity, integrationFixture } from "./test-fixtures";

const fixtures: ReturnType<typeof integrationFixture>[] = [];
const fixture = () => {
	const value = integrationFixture();
	fixtures.push(value);
	return value;
};
afterEach(async () => {
	await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
});
const key: HaKey = {
	entity_id: "light.desk",
	service: "turn_on",
	service_data: { brightness: 12 },
	custom_display_type: "custom",
	custom_display_settings: { fontSize: 40 },
	custom_display_detail: [
		{ displayItemKey: "brightness", displayAlias: "Level" },
	],
};
describe("production integration controller with real conductors and fake ports", () => {
	it("lists six channels without runtime, saves only credential references, preserves disabled state", async () => {
		const f = fixture();
		f.runtimePort.setAvailable(false);
		const initial = await f.request({ type: "channels.list" });
		expect(initial.type).toBe("channels");
		if (initial.type !== "channels") return;
		expect(initial.channels).toHaveLength(6);
		expect(initial.channels.every((c) => c.state === "Unavailable")).toBe(true);
		const saved = await f.request({
			type: "channels.save",
			id: "discord",
			fields: { token: "secret-discord-1234" },
			session: "",
		});
		expect(saved.type).toBe("channels");
		expect(JSON.stringify(saved)).not.toContain("secret-discord");
		expect(JSON.stringify(f.channels.read())).not.toContain("secret-discord");
		expect([...f.vault.values.values()]).toEqual([
			'{"token":"secret-discord-1234"}',
		]);
		f.runtimePort.setAvailable(true);
		let listed = await f.request({ type: "channels.list" });
		if (listed.type !== "channels") throw new TypeError();
		expect(listed.channels.find((c) => c.id === "discord")?.state).toBe(
			"Configured",
		);
		f.runtimePort.connected.push("discord");
		listed = await f.request({
			type: "channels.enable",
			id: "discord",
			enabled: false,
		});
		if (listed.type !== "channels") throw new TypeError();
		expect(listed.channels.find((c) => c.id === "discord")?.state).toBe(
			"Disabled",
		);
		expect(f.channels.read()).toMatchObject({
			channels: [{ enabled: false, credentialRef: "ref-1" }],
		});
	});
	it("validates each descriptor, Feishu policies and portal allowlist", async () => {
		const f = fixture();
		expect(
			await f.request({
				type: "channels.save",
				id: "qqbot",
				fields: { appId: "x" },
				session: "",
			}),
		).toMatchObject({ type: "error", field: "App Secret" });
		expect(
			await f.request({
				type: "channels.save",
				id: "feishu",
				fields: { appId: "app", appSecret: "secret", domain: "lark" },
				session: "",
			}),
		).toMatchObject({ type: "channels" });
		expect(f.channels.read()).toMatchObject({
			channels: [
				{
					publicFields: {
						domain: "lark",
						dmPolicy: "pairing",
						requireMention: "true",
					},
				},
			],
		});
		await f.request({ type: "channels.portal", id: "discord" });
		expect(f.opened).toEqual(["https://discord.com/developers/applications"]);
		expect(
			await f.request({
				type: "channels.portal",
				id: "discord",
				url: "https://attacker.invalid",
			}),
		).toMatchObject({ type: "error" });
	});
	it("cancels and expires QR sessions, ignores late confirmation, filters art, requires confirmed login", async () => {
		const f = fixture();
		const first = await f.request({
			type: "channels.qr.start",
			id: "openclaw-weixin",
		});
		if (first.type !== "qr") throw new TypeError();
		const receive = f.runtimePort.callbacks.get(first.session.id);
		receive?.({
			url: "https://example.test/qr",
			image: "data:image/png;base64,aA==",
			lines: ["████████", "waiting"],
		});
		expect(
			await f.request({
				type: "channels.save",
				id: "openclaw-weixin",
				fields: {},
				session: first.session.id,
			}),
		).toMatchObject({ type: "error" });
		expect(
			await f.request({ type: "channels.qr.read", session: first.session.id }),
		).toMatchObject({ session: { lines: ["waiting"], state: "ready" } });
		await f.request({ type: "channels.qr.cancel", session: first.session.id });
		receive?.({ confirmed: true });
		expect(
			await f.request({ type: "channels.qr.read", session: first.session.id }),
		).toMatchObject({ type: "error" });
		expect(f.runtimePort.cancelled()).toBe(1);
		const next = await f.request({ type: "channels.qr.start", id: "whatsapp" });
		if (next.type !== "qr") throw new TypeError();
		f.now(301001);
		expect(
			await f.request({ type: "channels.qr.read", session: next.session.id }),
		).toMatchObject({ session: { state: "expired", image: "", url: "" } });
	});
	it("requires explicit pairing, sends one approval under concurrent clicks and rejects unknown codes", async () => {
		const f = fixture();
		expect(f.runtimePort.approvals).toEqual([]);
		await Promise.all([
			f.request({
				type: "channels.approve",
				id: "openclaw-weixin",
				code: "X7K2",
			}),
			f.request({
				type: "channels.approve",
				id: "openclaw-weixin",
				code: "X7K2",
			}),
		]);
		expect(f.runtimePort.approvals).toEqual(["openclaw-weixin:X7K2"]);
		expect(
			await f.request({
				type: "channels.approve",
				id: "openclaw-weixin",
				code: "unknown",
			}),
		).toMatchObject({ type: "error", field: "pairing code" });
	});
	it("never evaluates output, drops command/launch entries and rejects malformed output without changing libraries", async () => {
		const f = fixture();
		f.model(
			'{"ConfigTitle":"Editing","ConfigData":[{"title":"bad","config":{"functionType":"cmd","actions":[{"operationName":"cmdLine","operationValue":"rm -rf ~"}]}},{"title":"","config":{"functionType":"hotkey","actions":[{"type":"key","value":"Ctrl + Shift + K"}]}}]}',
		);
		expect(
			await f.request({
				type: "shortcuts.generate",
				app: "Figma",
				prompt: "Common shortcuts",
			}),
		).toMatchObject({
			type: "draft",
			title: "Editing",
			dropped: 1,
			rows: [{ name: "Shortcut 2", chord: "control+shift+k", app: "Figma" }],
		});
		f.model("({a: alert(1)})");
		expect(
			await f.request({
				type: "shortcuts.generate",
				app: "Figma",
				prompt: "Common",
			}),
		).toMatchObject({ type: "error", code: "INTEGRATION.INPUT.REJECTED" });
		expect(f.shortcuts.writes).toEqual([]);
	});
	it("normalizes chords, detects conflicts, persists manual libraries and refuses invalid renames", async () => {
		expect(normalizeChord("Win + Shift + K")).toBe("shift+meta+k");
		expect(() => normalizeChord("Ctrl + Banana")).toThrow(
			"Invalid configuration",
		);
		const row = {
			id: "manual",
			name: "Copy",
			app: "Office",
			chord: "control+k",
		};
		expect([...conflictIds([row, { ...row, id: "second" }])]).toEqual([
			"manual",
			"second",
		]);
		const f = fixture();
		let reply = await f.request({
			type: "shortcuts.save",
			library: {
				id: "",
				name: "Editing",
				app: "Office",
				createdAt: "",
				rows: [row],
			},
		});
		if (reply.type !== "libraries") throw new TypeError();
		const lib = reply.libraries[0];
		if (!lib) throw new TypeError();
		expect(
			await f.request({
				type: "shortcuts.save",
				library: { ...lib, name: "Cut/Paste" },
			}),
		).toMatchObject({ type: "error" });
		reply = await f.request({ type: "shortcuts.list" });
		expect(reply).toMatchObject({
			libraries: [{ name: "Editing", rows: [row] }],
		});
	});
	it("masks tokens, normalizes origin, defaults AI domains and persists only selected leaf IDs", async () => {
		const f = fixture();
		const reply = await f.request({
			type: "ha.connect",
			origin: "https://ha.example:8123/lovelace/12",
			token: "long-token-a9F2",
		});
		expect(reply).toMatchObject({
			snapshot: {
				origin: "https://ha.example:8123",
				tokenMask: "••••a9F2",
				state: "Connected",
				allowlist: ["light.desk"],
			},
		});
		expect(JSON.stringify(reply)).not.toContain("long-token");
		expect(JSON.stringify(f.ha.read())).not.toContain("long-token");
		expect(await f.request({ type: "ha.allowlist", ids: [] })).toMatchObject({
			type: "error",
		});
		expect(
			await f.request({ type: "ha.allowlist", ids: ["Study", "light.desk"] }),
		).toMatchObject({ snapshot: { allowlist: ["light.desk"] } });
		expect(
			await f.runtime.runPromise(HomeAssistantService.aiEntities()),
		).toEqual([entity]);
	});
	it("requires matching explicit certificate consent, scopes it, and clears live states on revocation", async () => {
		const f = fixture();
		f.openError(
			new HaCertificateRejected(
				new Error("secret-value"),
				"https://ha.example",
				"AA:BB",
			),
		);
		expect(
			await f.request({
				type: "ha.connect",
				origin: "https://ha.example",
				token: "private-1234",
			}),
		).toMatchObject({ type: "error", code: "HA.CERTIFICATE.REJECTED" });
		expect(
			await f.request({
				type: "ha.trust",
				certificate: {
					origin: "https://attacker.example",
					fingerprint: "AA:BB",
				},
			}),
		).toMatchObject({ type: "error" });
		expect(
			await f.request({
				type: "ha.trust",
				certificate: { origin: "https://ha.example", fingerprint: "AA:BB" },
			}),
		).toMatchObject({
			snapshot: {
				trusted: [{ origin: "https://ha.example", fingerprint: "AA:BB" }],
			},
		});
		f.openError(undefined);
		await f.request({
			type: "ha.connect",
			origin: "https://ha.example",
			token: "",
		});
		await f.request({ type: "ha.revoke", origin: "https://ha.example" });
		expect(await f.request({ type: "ha.live" })).toEqual({
			type: "live",
			live: { connected: false, states: [] },
		});
	});
	it("validates HA fields before placement and polls only visible active entities, clearing stale values on failure", async () => {
		const f = fixture();
		await f.request({
			type: "ha.connect",
			origin: "http://ha.example",
			allowInsecureHttp: true,
			token: "private",
		});
		const target = { profileId: "p", pageId: "page", keyCode: "1,1" };
		expect(
			await f.request({
				type: "ha.key",
				target,
				key: { ...key, service_data: { brightness: 300 } },
			}),
		).toMatchObject({ type: "error", field: "brightness" });
		expect(f.placed).toEqual([]);
		await f.request({ type: "ha.key", target, key });
		expect(f.placed).toHaveLength(1);
		await f.runtime.runPromise(HomeAssistantService.setVisible(["light.desk"]));
		f.entities([{ ...entity, state: "on" }]);
		const live = await f.runtime.runPromise(HomeAssistantService.poll());
		expect(f.reads).toEqual([["light.desk"]]);
		expect(
			tileLines(
				{ ...key, custom_display_type: "default" },
				live.states[0],
				live.connected,
			),
		).toEqual(["on"]);
		f.failRead();
		await f.runtime.runPromise(HomeAssistantService.poll().pipe(Effect.either));
		expect(await f.request({ type: "ha.live" })).toEqual({
			type: "live",
			live: { connected: false, states: [] },
		});
		expect(tileLines(key, entity, false)).toEqual(["unavailable"]);
	});
	it("retains original failure privately while controller projections scrub causes and secrets", async () => {
		const cause = new TypeError("token=secret-value");
		const error = new StoreFailed(cause);
		expect(error.originalCause).toBe(cause);
		expect(JSON.stringify(error)).not.toContain("secret-value");
		const f = fixture();
		f.shortcuts.setFail(true);
		const reply = await f.request({
			type: "shortcuts.save",
			library: {
				id: "",
				name: "Editing",
				app: "Office",
				createdAt: "",
				rows: [{ id: "a", name: "Copy", app: "Office", chord: "control+c" }],
			},
		});
		expect(reply).toMatchObject({
			type: "error",
			code: "INTEGRATION.STORE.FAILED",
		});
		expect(JSON.stringify(reply)).not.toContain("secret-value");
		expect(await f.runtime.runPromise(ChannelService.list())).toHaveLength(6);
	});
});

describe("failure recovery and validated HA execution", () => {
	it("durably retains a cleanup reference after local deletion when vault removal fails, allowing retry", async () => {
		const f = fixture();
		await f.request({
			type: "channels.save",
			id: "discord",
			fields: { token: "secret-value" },
			session: "",
		});
		f.vault.failRemove(true);
		expect(
			await f.request({ type: "channels.remove", id: "discord" }),
		).toMatchObject({ type: "error", code: "INTEGRATION.CREDENTIAL.FAILED" });
		expect(f.channels.read()).toMatchObject({
			channels: [],
			pendingCredentialRefs: ["ref-1"],
		});
		f.vault.failRemove(false);
		expect(
			await f.request({ type: "channels.remove", id: "discord" }),
		).toMatchObject({ type: "channels" });
		expect(f.channels.read()).toEqual({
			version: 1,
			channels: [],
			pendingCredentialRefs: [],
		});
		expect(f.vault.values.size).toBe(0);
	});
	it("uses the same validated execution path for direct keys and allowlisted AI, rejecting unknown targets without side effects", async () => {
		const f = fixture();
		f.entities([entity, { ...entity, entity_id: "light.private" }]);
		await f.request({
			type: "ha.connect",
			origin: "http://home.test",
			allowInsecureHttp: true,
			token: "private",
		});
		await f.request({ type: "ha.allowlist", ids: ["light.desk"] });
		await f.runtime.runPromise(HomeAssistantService.execute(key, true));
		expect(f.executions).toEqual([
			{
				domain: "light",
				service: "turn_on",
				data: { entity_id: "light.desk", brightness: 12 },
			},
		]);
		const rejected = await f.runtime.runPromise(
			HomeAssistantService.execute(
				{ ...key, entity_id: "light.private" },
				true,
			).pipe(Effect.either),
		);
		expect(rejected._tag).toBe("Left");
		expect(f.executions).toHaveLength(1);
		const invalid = await f.runtime.runPromise(
			HomeAssistantService.execute({ ...key, entity_id: "light.unknown" }).pipe(
				Effect.either,
			),
		);
		expect(invalid._tag).toBe("Left");
		expect(f.executions).toHaveLength(1);
		await f.runtime.runPromise(
			HomeAssistantService.execute({ ...key, entity_id: "light.private" }),
		);
		expect(f.executions).toHaveLength(2);
	});
});
