import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Layer, ManagedRuntime } from "effect";
import { expect, it, vi } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import { makeIntegrationController } from "../integrations/controller";
import { prepareIntegrations } from "../integrations/index";
import { fakeVault } from "../integrations/test-fixtures";
import type { ChannelCommand } from "./channel-command";
import { createLocalChannelRuntime } from "./channel-runtime";

const host = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({
	app: { getPath: () => host.root },
	BrowserWindow: { getAllWindows: () => [] },
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
	shell: {},
}));
it("CENTER-074/077/078/079 production registration uses the local adapter for setup, verified QR, cancel and single pairing approval", async () => {
	host.root = await mkdtemp(join(tmpdir(), "agents-channel-registration-"));
	const profiles = ManagedRuntime.make(
		ProfileService.DefaultWithoutDependencies.pipe(
			Layer.provideMerge(
				ProfileRepository.Default.pipe(
					Layer.provide(
						profileStorageLayer({
							read: async () =>
								encodeProfileEnvelope(createInitialProfileEnvelope()),
							write: async () => {},
						}),
					),
				),
			),
		),
	);
	const calls: ChannelCommand[] = [];
	let connected = false,
		pending = true,
		login: ChannelCommand | undefined,
		finish: () => void = () => {};
	const adapter = createLocalChannelRuntime({
		root: join(host.root, "runtime"),
		run: async (command) => {
			calls.push(command);
			if (command.args[1] === "list" && command.args[0] === "channels")
				return JSON.stringify({
					chat: { discord: { installed: true }, whatsapp: { installed: true } },
				});
			if (command.args[1] === "status")
				return JSON.stringify({
					channelAccounts: connected ? { whatsapp: [{ connected: true }] } : {},
				});
			if (command.args[1] === "login") {
				login = command;
				return new Promise((resolve) => {
					finish = () => resolve("");
				});
			}
			if (command.args[1] === "list")
				return JSON.stringify({
					channel: "discord",
					requests: pending
						? [
								{
									id: "fake-sender",
									code: "ABC123",
									createdAt: "2026-10-26T12:00:00Z",
								},
							]
						: [],
				});
			if (command.args[1] === "approve") pending = false;
			return "";
		},
	});
	const prepared = prepareIntegrations({
		management: () => undefined,
		rendererURL: "file:///fixture/index.html",
		profileRuntime: profiles,
		channelRuntime: adapter,
		vault: fakeVault().port,
	});
	const application = ManagedRuntime.make(prepared.layer);
	prepared.bind(application);
	await application.runtime();
	const registration = prepared.start();
	try {
		const controller = await application.runPromise(
			makeIntegrationController({
				openExternal: async () => {},
				targets: async () => [],
			}),
		);
		const request = (command: Parameters<typeof controller.request>[0]) =>
			application.runPromise(controller.request(command));
		const saved = await request({
			type: "channels.save",
			id: "discord",
			fields: { token: "fake-private-discord" },
			session: "",
		});
		expect(saved).toMatchObject({
			type: "channels",
			channels: expect.arrayContaining([
				expect.objectContaining({ id: "discord", state: "Configured" }),
			]),
		});
		expect(JSON.stringify(saved) + JSON.stringify(calls)).not.toContain(
			"fake-private-discord",
		);
		const first = await request({ type: "channels.qr.start", id: "whatsapp" });
		if (first.type !== "qr") throw new Error("Missing QR");
		login?.onLine?.("Scan https://example.test/qr");
		expect(
			await request({ type: "channels.qr.read", session: first.session.id }),
		).toMatchObject({ type: "qr", session: { state: "ready" } });
		await request({ type: "channels.qr.cancel", session: first.session.id });
		expect(login?.signal?.aborted).toBe(true);
		finish();
		expect(
			await request({ type: "channels.qr.read", session: first.session.id }),
		).toMatchObject({ type: "error" });
		const next = await request({ type: "channels.qr.start", id: "whatsapp" });
		if (next.type !== "qr") throw new Error("Missing QR");
		connected = true;
		finish();
		await vi.waitFor(async () =>
			expect(
				await request({ type: "channels.qr.read", session: next.session.id }),
			).toMatchObject({ type: "qr", session: { state: "confirmed" } }),
		);
		expect(
			await request({ type: "channels.pairings", id: "discord" }),
		).toMatchObject({
			type: "pairings",
			pairings: [
				{
					code: "ABC123",
					sender: "fake-sender",
					createdAt: Date.parse("2026-10-26T12:00:00Z"),
				},
			],
		});
		await Promise.all([
			request({ type: "channels.approve", id: "discord", code: "ABC123" }),
			request({ type: "channels.approve", id: "discord", code: "ABC123" }),
		]);
		expect(
			calls.filter((c) => c.args[0] === "pairing" && c.args[1] === "approve"),
		).toHaveLength(1);
	} finally {
		await registration.dispose();
		await application.dispose();
		await profiles.dispose();
		await rm(host.root, { recursive: true, force: true });
	}
});
