import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { HaAuthenticationFailed } from "../../../../../packages/edge/src/channels/integration-errors";
import { HomeAssistantService } from "../../../../../packages/edge/src/home-assistant/ha-service";
import { entity, integrationFixture } from "./test-fixtures";

describe("PR33 production controller regressions", () => {
	it("preserves configured secrets on concurrent public edits and rejects missing new credentials", async () => {
		const f = integrationFixture();
		try {
			expect(
				await f.request({
					type: "channels.save",
					id: "feishu",
					fields: {
						appId: "old",
						appSecret: "synthetic-private",
						domain: "feishu",
					},
					session: "",
				}),
			).toMatchObject({ type: "channels" });
			const replies = await Promise.all(
				["new-a", "new-b"].map((appId) =>
					f.request({
						type: "channels.save",
						id: "feishu",
						fields: { appId, domain: "lark" },
						session: "",
					}),
				),
			);
			expect(replies.every((r) => r.type === "channels")).toBe(true);
			expect([...f.vault.values.values()]).toEqual([
				'{"appSecret":"synthetic-private"}',
			]);
			expect(JSON.stringify(replies)).not.toContain("synthetic-private");
			expect(
				await f.request({
					type: "channels.save",
					id: "discord",
					fields: {},
					session: "",
				}),
			).toMatchObject({ type: "error" });
		} finally {
			await f.dispose();
		}
	});
	it("keeps credentials usable when deleting fails to persist and permits deletion with unavailable runtime", async () => {
		const f = integrationFixture();
		try {
			await f.request({
				type: "channels.save",
				id: "discord",
				fields: { token: "synthetic-private" },
				session: "",
			});
			f.runtimePort.setRemoveUnavailable(true);
			f.channels.setFail(true);
			expect(
				await f.request({ type: "channels.remove", id: "discord" }),
			).toMatchObject({ type: "error", code: "INTEGRATION.STORE.FAILED" });
			expect(f.channels.read()).toMatchObject({
				channels: [{ credentialRef: "ref-1" }],
			});
			expect(f.vault.values.has("ref-1")).toBe(true);
			f.channels.setFail(false);
			expect(
				await f.request({
					type: "channels.enable",
					id: "discord",
					enabled: true,
				}),
			).toMatchObject({ type: "channels" });
			expect(
				await f.request({ type: "channels.remove", id: "discord" }),
			).toMatchObject({ type: "channels" });
			expect(f.vault.values.size).toBe(0);
		} finally {
			await f.dispose();
		}
	});
	it("hydrates previous-session secrets before QR callbacks and redacts before truncation", async () => {
		const f = integrationFixture();
		await f.request({
			type: "channels.save",
			id: "discord",
			fields: { token: "synthetic-private-token" },
			session: "",
		});
		await f.dispose();
		const restarted = integrationFixture({
			channels: f.channels,
			vault: f.vault,
		});
		try {
			const reply = await restarted.request({
				type: "channels.qr.start",
				id: "whatsapp",
			});
			if (reply.type !== "qr") throw new TypeError("Missing QR");
			restarted.runtimePort.callbacks.get(reply.session.id)?.({
				lines: [
					"raw synthetic-private-token",
					`${"a".repeat(290)}synthetic-private-token`,
				],
			});
			const read = await restarted.request({
				type: "channels.qr.read",
				session: reply.session.id,
			});
			expect(JSON.stringify(read)).not.toContain("synthetic-private");
			expect(read).toMatchObject({
				session: { lines: ["raw ••••", `${"a".repeat(290)}••••`] },
			});
		} finally {
			await restarted.dispose();
		}
	});
	it("clears catalogs on trust revocation and failed reconnect; projects canonical errors", async () => {
		const f = integrationFixture();
		try {
			await f.request({
				type: "ha.connect",
				origin: "https://ha.test",
				token: "synthetic-private",
			});
			expect(
				await f.request({ type: "ha.revoke", origin: "https://ha.test" }),
			).toMatchObject({
				snapshot: { state: "Disconnected", entities: [], services: [] },
			});
			const failure = new HaAuthenticationFailed(
				new Error("synthetic-private"),
			);
			Object.defineProperty(failure, "message", { value: "synthetic-private" });
			f.openError(failure);
			expect(
				await f.request({
					type: "ha.connect",
					origin: "https://ha.test",
					token: "",
				}),
			).toMatchObject({
				type: "error",
				message: "Home Assistant authentication failed",
			});
			const snapshot = await f.request({ type: "ha.read" });
			expect(JSON.stringify(snapshot)).not.toContain("synthetic-private");
			expect(snapshot).toMatchObject({
				snapshot: {
					entities: [],
					services: [],
					reason: "Home Assistant authentication failed",
				},
			});
			expect(
				await f.runtime.runPromise(HomeAssistantService.aiEntities()),
			).toEqual([]);
		} finally {
			await f.dispose();
		}
	});
	it("rejects HTTP without consent before touching the vault or connector", async () => {
		const f = integrationFixture();
		try {
			expect(
				await f.request({
					type: "ha.connect",
					origin: "http://ha.test",
					token: "synthetic-private",
				}),
			).toMatchObject({ type: "error", field: "Unencrypted HTTP consent" });
			expect(f.vault.values.size).toBe(0);
			expect(
				await f.request({
					type: "ha.connect",
					origin: "http://ha.test",
					token: "synthetic-private",
					allowInsecureHttp: true,
				}),
			).toMatchObject({ snapshot: { state: "Connected" } });
		} finally {
			await f.dispose();
		}
	});
});

it("executes saved direct and allowed AI actions after live display attributes disappear while save still validates display", async () => {
	const f = integrationFixture();
	try {
		await f.request({
			type: "ha.connect",
			origin: "https://ha.test",
			token: "synthetic",
		});
		const key = {
			entity_id: "light.desk",
			service: "turn_on",
			service_data: { brightness: 12 },
			custom_display_type: "custom",
			custom_display_settings: { fontSize: 40 },
			custom_display_detail: [
				{ displayItemKey: "brightness", displayAlias: "Level" },
			],
		} as const;
		const target = { profileId: "profile", pageId: "page", keyCode: "1,1" };
		expect(await f.request({ type: "ha.key", target, key })).toMatchObject({
			type: "ok",
		});
		await f.runtime.runPromise(HomeAssistantService.setVisible(["light.desk"]));
		f.entities([{ ...entity, state: "off", attributes: {} }]);
		await f.runtime.runPromise(HomeAssistantService.poll());
		await f.runtime.runPromise(HomeAssistantService.execute(key));
		await f.runtime.runPromise(HomeAssistantService.execute(key, true));
		expect(f.executions).toHaveLength(2);
		expect(f.executions[0]).toMatchObject({
			data: {
				entity_id: "light.desk",
				brightness: 12,
			},
		});
		expect(await f.request({ type: "ha.key", target, key })).toMatchObject({
			type: "error",
			field: "Display Info",
		});
		await f.request({ type: "ha.allowlist", ids: ["button.reset"] });
		const denied = await f.runtime.runPromise(
			HomeAssistantService.execute(key, true).pipe(Effect.either),
		);
		expect(denied._tag === "Left" && denied.left.code).toBe(
			"INTEGRATION.INPUT.REJECTED",
		);
		expect(f.executions).toHaveLength(2);
	} finally {
		await f.dispose();
	}
});
