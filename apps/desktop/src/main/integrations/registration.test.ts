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
import { ChannelService } from "../../../../../packages/edge/src/channels/channel-service";
import { HomeAssistantService } from "../../../../../packages/edge/src/home-assistant/ha-service";
import { prepareIntegrations } from "./index";
import { fakeChannels, fakeVault } from "./test-fixtures";

const host = vi.hoisted(() => ({ root: "" }));
vi.mock("electron", () => ({
	app: { getPath: () => host.root },
	BrowserWindow: { getAllWindows: () => [] },
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
	shell: {},
}));
it("keeps shared HA and QR sessions until graph disposal", async () => {
	host.root = await mkdtemp(join(tmpdir(), "oq-integrations-shared-"));
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
	const channel = fakeChannels();
	const vault = fakeVault();
	const close = vi.fn();
	const prepared = prepareIntegrations({
		management: () => undefined,
		rendererURL: "file:///synthetic/index.html",
		profileRuntime: profiles,
		channelRuntime: channel.port,
		vault: vault.port,
		openHa: async () => ({
			entities: async () => [],
			services: async () => [],
			states: async () => [],
			execute: async () => {},
			close,
		}),
	});
	const application = ManagedRuntime.make(prepared.layer);
	prepared.bind(application);
	await application.runtime();
	const registration = prepared.start();
	try {
		await application.runPromise(
			HomeAssistantService.connect(
				"http://fixture.invalid:8123",
				"fixture-token",
				true,
			),
		);
		const qr = await application.runPromise(ChannelService.startQr("whatsapp"));
		await registration.dispose();
		expect(close).not.toHaveBeenCalled();
		expect(channel.cancelled()).toBe(0);
		expect(
			await application.runPromise(HomeAssistantService.snapshot()),
		).toMatchObject({ state: "Connected" });
		expect(
			await application.runPromise(ChannelService.readQr(qr.id)),
		).toMatchObject({ state: "pending" });
		await application.dispose();
		expect(close).toHaveBeenCalledOnce();
		expect(channel.cancelled()).toBe(1);
	} finally {
		await registration.dispose();
		await application.dispose();
		await profiles.dispose();
		await rm(host.root, { recursive: true, force: true });
	}
});
