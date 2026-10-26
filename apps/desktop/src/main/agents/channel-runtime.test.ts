import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { expect, it, vi } from "vitest";
import type { ChannelId } from "../../../../../packages/edge/src/channels/channel-contracts";
import {
	ChannelPorts,
	ChannelService,
} from "../../../../../packages/edge/src/channels/channel-service";
import type { ChannelCommand } from "./channel-command";
import { createLocalChannelRuntime } from "./channel-runtime";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "channel-runtime-"));
	const calls: ChannelCommand[] = [];
	let connected: ChannelId[] = [];
	let available = true;
	let pending = true;
	let now = 10;
	let qr: ChannelCommand | undefined,
		finish: () => void = () => {};
	const adapter = createLocalChannelRuntime({
		root,
		run: async (command) => {
			calls.push(command);
			if (command.args[0] === "channels" && command.args[1] === "status")
				return JSON.stringify(
					available
						? {
								channelAccounts: Object.fromEntries(
									connected.map((id) => [
										id,
										[{ connected: true, enabled: true }],
									]),
								),
							}
						: { configOnly: true, gatewayReachable: false },
				);
			if (command.args[0] === "channels" && command.args[1] === "list")
				return JSON.stringify({
					chat: {
						discord: { installed: true },
						whatsapp: { installed: true },
						feishu: { installed: true },
					},
				});
			if (command.args[0] === "channels" && command.args[1] === "login") {
				qr = command;
				return new Promise((resolve) => {
					finish = () => resolve("");
				});
			}
			if (command.args[0] === "pairing" && command.args[1] === "list")
				return JSON.stringify({
					channel: "discord",
					requests: pending
						? [
								{
									id: "sender",
									code: "ABC123",
									createdAt: "2026-10-26T12:00:00Z",
								},
							]
						: [],
				});
			if (command.args[0] === "pairing" && command.args[1] === "approve") {
				pending = false;
				return "Approved";
			}
			return "";
		},
	});
	let saved: unknown = { version: 1, channels: [] };
	let seq = 0;
	const vault = new Map<string, string>();
	const runtime = ManagedRuntime.make(
		ChannelService.Default.pipe(
			Layer.provide(
				Layer.succeed(ChannelPorts, {
					store: {
						read: async () => saved,
						write: async (value) => {
							saved = value;
						},
					},
					vault: {
						put: async (value) => {
							const ref = `vault-${++seq}`;
							vault.set(ref, value);
							return ref;
						},
						get: async (ref) => vault.get(ref) ?? "",
						remove: async (ref) => {
							vault.delete(ref);
						},
					},
					runtime: adapter,
					now: () => now,
					id: () => `qr-${++seq}`,
				}),
			),
		),
	);
	return {
		root,
		calls,
		adapter,
		runtime,
		save: () => saved,
		offline: () => {
			available = false;
		},
		connect: (ids: ChannelId[]) => {
			connected = ids;
		},
		tick: () => {
			now += 300001;
		},
		qr: () => qr,
		finish: () => finish(),
		close: async () => {
			await runtime.dispose();
			await rm(root, { recursive: true, force: true });
		},
	};
}
it("CENTER-074/077 maps credential-isolated channel config, verifies actual status and retains disabled data", async () => {
	const f = await fixture();
	try {
		const saved = await f.runtime.runPromise(
			ChannelService.save("discord", { token: "private-discord-token" }),
		);
		expect(saved.find((x) => x.id === "discord")?.state).toBe("Configured");
		expect(
			JSON.stringify(saved) +
				JSON.stringify(f.save()) +
				JSON.stringify(f.calls),
		).not.toContain("private-discord-token");
		const config = JSON.parse(
			await readFile(join(f.root, "openclaw.json"), "utf8"),
		);
		expect(config.channels.discord).toEqual({
			enabled: true,
			token: "private-discord-token",
		});
		expect(config.gateway.bind).toBe("loopback");
		expect((await stat(join(f.root, "openclaw.json"))).mode & 0o777).toBe(
			0o600,
		);
		f.connect(["discord"]);
		expect(
			(await f.runtime.runPromise(ChannelService.list())).find(
				(x) => x.id === "discord",
			)?.state,
		).toBe("Connected");
		expect(
			(
				await f.runtime.runPromise(ChannelService.setEnabled("discord", false))
			).find((x) => x.id === "discord")?.state,
		).toBe("Disabled");
		expect(
			JSON.parse(await readFile(join(f.root, "openclaw.json"), "utf8")).channels
				.discord,
		).toEqual({ enabled: false, token: "private-discord-token" });
		f.offline();
		expect(
			(await f.runtime.runPromise(ChannelService.list())).find(
				(x) => x.id === "discord",
			)?.state,
		).toBe("Unavailable");
		await f.runtime.runPromise(ChannelService.remove("discord"));
		expect(
			JSON.parse(await readFile(join(f.root, "openclaw.json"), "utf8")).channels
				.discord,
		).toBeUndefined();
		expect(
			f.calls.some(
				(c) =>
					c.args.join(" ") === "channels remove --channel discord --delete",
			),
		).toBe(true);
	} finally {
		await f.close();
	}
});
it("CENTER-077 rejects invalid credentials/plugin absence before config mutation and never installs", async () => {
	const f = await fixture();
	try {
		await expect(
			f.adapter.configure(
				{
					id: "discord",
					enabled: true,
					credentialRef: "opaque",
					publicFields: {},
				},
				{},
			),
		).rejects.toMatchObject({ code: "INTEGRATION.INPUT.REJECTED" });
		await expect(
			f.adapter.configure(
				{
					id: "wecom",
					enabled: true,
					credentialRef: "opaque",
					publicFields: { botId: "id" },
				},
				{ secret: "private" },
			),
		).rejects.toMatchObject({ code: "INTEGRATION.RUNTIME.UNAVAILABLE" });
		expect(f.calls.some((c) => c.args.includes("install"))).toBe(false);
		expect(
			await f.runtime.runPromise(
				ChannelService.save("discord", { token: "" }).pipe(Effect.either),
			),
		).toMatchObject({ _tag: "Left" });
	} finally {
		await f.close();
	}
});
it("CENTER-078 cancels and expires QR and accepts completion only with verified connected status", async () => {
	const f = await fixture();
	try {
		let qr = await f.runtime.runPromise(ChannelService.startQr("whatsapp"));
		f.qr()?.onLine?.("Scan https://web.whatsapp.com/qr");
		expect(
			await f.runtime.runPromise(ChannelService.readQr(qr.id)),
		).toMatchObject({ state: "ready", url: "https://web.whatsapp.com/qr" });
		await f.runtime.runPromise(ChannelService.cancelQr(qr.id));
		expect(f.qr()?.signal?.aborted).toBe(true);
		f.finish();
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(
			await f.runtime.runPromise(
				ChannelService.readQr(qr.id).pipe(Effect.either),
			),
		).toMatchObject({ _tag: "Left" });
		qr = await f.runtime.runPromise(ChannelService.startQr("whatsapp"));
		f.tick();
		expect(
			await f.runtime.runPromise(ChannelService.readQr(qr.id)),
		).toMatchObject({ state: "expired" });
		expect(f.qr()?.signal?.aborted).toBe(true);
		qr = await f.runtime.runPromise(ChannelService.startQr("whatsapp"));
		f.finish();
		await vi.waitFor(async () =>
			expect(
				await f.runtime.runPromise(ChannelService.readQr(qr.id)),
			).toMatchObject({ state: "failed" }),
		);
		qr = await f.runtime.runPromise(ChannelService.startQr("whatsapp"));
		f.connect(["whatsapp"]);
		f.finish();
		await vi.waitFor(async () =>
			expect(
				await f.runtime.runPromise(ChannelService.readQr(qr.id)),
			).toMatchObject({ state: "confirmed" }),
		);
		expect(
			(
				await f.runtime.runPromise(ChannelService.save("whatsapp", {}, qr.id))
			).find((x) => x.id === "whatsapp")?.state,
		).toBe("Connected");
	} finally {
		await f.close();
	}
});
it("CENTER-079 pending approval dispatches once and rejects unknown or consumed codes", async () => {
	const f = await fixture();
	try {
		expect(
			await f.runtime.runPromise(ChannelService.pairings("discord")),
		).toHaveLength(1);
		await Promise.all([
			f.runtime.runPromise(ChannelService.approve("discord", "ABC123")),
			f.runtime.runPromise(ChannelService.approve("discord", "ABC123")),
		]);
		expect(
			f.calls.filter((c) => c.args[0] === "pairing" && c.args[1] === "approve"),
		).toHaveLength(1);
		expect(
			await f.runtime.runPromise(
				ChannelService.approve("discord", "unknown").pipe(Effect.either),
			),
		).toMatchObject({ _tag: "Left" });
		await expect(f.adapter.approve("discord", "ABC123")).rejects.toMatchObject({
			code: "INTEGRATION.INPUT.REJECTED",
		});
	} finally {
		await f.close();
	}
});
