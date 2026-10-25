import { Cause, Effect, Layer, ManagedRuntime, Schema } from "effect";
import { BrowserWindow, ipcMain } from "electron";
import { expect, it, vi } from "vitest";
import { HostActionFailed } from "../../../../../packages/device/src/actions/action-errors";
import { KeyRuntime } from "../../../../../packages/device/src/actions/key-runtime-service";
import {
	createEmptyProfileKey,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import { HaNetworkFailed } from "../../../../../packages/edge/src/channels/integration-errors";
import type { HaKey } from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import {
	INTEGRATIONS_REQUEST,
	type IntegrationReply,
} from "../../shared/integrations";
import { desktopKeyRuntimePort } from "../key-library/runtime-port";
import { ManagementProfileContractsLive } from "../management/profile-contracts";
import { registerIntegrations } from "./index";
import { integrationKeyAction } from "./key-action";
import { fakeVault, memoryStore } from "./test-fixtures";

vi.mock("electron", () => ({
	clipboard: {},
	shell: {},
	app: { getPath: () => "/synthetic/integration-cancellation" },
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
	BrowserWindow: { fromWebContents: vi.fn(), getAllWindows: () => [] },
}));
vi.mock("./storage", () => ({
	fileStore: (_root: string, _name: string, initial: unknown) =>
		memoryStore(initial).port,
}));
const config: HaKey = {
	entity_id: "input_boolean.acceptance",
	service: "toggle",
	service_data: {},
	custom_display_type: "default",
	custom_display_settings: { fontSize: 20 },
	custom_display_detail: [{ displayItemKey: "state", displayAlias: "State" }],
};
function key() {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	return {
		...empty,
		childrenName: "homeAssistant",
		config: {
			...empty.config,
			type: "homeAssistant",
			display: true,
			actions: [{ type: "configData", value: JSON.stringify(config) }],
		},
	};
}
function profileLayer(input: ReturnType<typeof key>) {
	return ProfileService.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(
			ProfileRepository.DefaultWithoutDependencies.pipe(
				Layer.provide(
					profileStorageLayer({
						read: async () => ({
							schemaVersion: 1,
							profiles: [
								{
									id: "p",
									name: "Synthetic",
									revision: 3,
									pages: [{ id: "one", keys: [input] }],
								},
							],
							activeByDevice: { device: { profileId: "p", pageId: "one" } },
						}),
						write: async () => {},
					}),
				),
				Layer.provide(ManagementProfileContractsLive),
			),
		),
	);
}
function layer(
	input: ReturnType<typeof key>,
	execute: (key: HaKey, signal: AbortSignal) => Promise<void>,
	mock = false,
) {
	const profiles = profileLayer(input);
	return KeyRuntime.DefaultWithoutDependencies.pipe(
		Layer.provide(
			desktopKeyRuntimePort(
				() => undefined,
				() => {},
				mock,
				integrationKeyAction(execute),
			).pipe(Layer.provide(profiles)),
		),
	);
}
const expected = { profileId: "p", pageId: "one", revision: 3 };
it("executes committed HA keys once per press and bypasses the generic action rejection", async () => {
	const execute = vi.fn(async (_key: HaKey) => {});
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* KeyRuntime.activate("device", "1,1", "press", expected);
			yield* KeyRuntime.activate("device", "1,1", "press", expected);
			expect(execute).toHaveBeenCalledExactlyOnceWith(
				config,
				expect.any(AbortSignal),
			);
			yield* KeyRuntime.activate("device", "1,1", "release", expected);
			yield* KeyRuntime.activate("device", "1,1", "press", expected);
		}).pipe(Effect.provide(layer(key(), execute)), Effect.scoped),
	);
	expect(execute).toHaveBeenCalledTimes(2);
});
it.each(["revision", "profile", "page", "hidden", "quarantined"] as const)(
	"keeps the %s guard ahead of integration execution",
	async (guard) => {
		const execute = vi.fn(async (_key: HaKey) => {});
		const input = key();
		const wanted = { ...expected };
		if (guard === "revision") wanted.revision = 2;
		if (guard === "profile") wanted.profileId = "other";
		if (guard === "page") wanted.pageId = "other";
		if (guard === "hidden") input.config.display = false;
		const candidate =
			guard === "quarantined"
				? { ...input, compatibility: { unsupported: true } }
				: input;
		await Effect.runPromise(
			KeyRuntime.activate("device", "1,1", "press", wanted).pipe(
				Effect.provide(layer(candidate, execute)),
				Effect.scoped,
			),
		);
		expect(execute).not.toHaveBeenCalled();
	},
);
it("preserves a failed HA dependency as the typed host error cause", async () => {
	const cause = new HaNetworkFailed(
		new Error("acceptance-private-token-value"),
	);
	const execute = vi.fn(async (_key: HaKey) => {
		throw cause;
	});
	const error = await Effect.runPromise(
		KeyRuntime.activate("device", "1,1", "press", expected).pipe(
			Effect.flip,
			Effect.provide(layer(key(), execute)),
			Effect.scoped,
		),
	);
	expect(error).toBeInstanceOf(HostActionFailed);
	expect(error.originalCause).toBe(cause);
	expect(JSON.stringify(error)).not.toContain("acceptance-private-token-value");
});
it("keeps mock-device runs from executing the external integration", async () => {
	const execute = vi.fn(async (_key: HaKey) => {});
	await Effect.runPromise(
		KeyRuntime.activate("device", "1,1", "press", expected).pipe(
			Effect.either,
			Effect.provide(layer(key(), execute, true)),
			Effect.scoped,
		),
	);
	expect(execute).not.toHaveBeenCalled();
});
it("leaves unrelated key types with their existing runtime", async () => {
	const execute = vi.fn(async (_key: HaKey) => {});
	expect(
		await integrationKeyAction(execute)(
			createEmptyProfileKey("1,1"),
			new AbortController().signal,
		),
	).toBe(false);
	const malformed = key();
	malformed.config.actions = [];
	await expect(
		integrationKeyAction(execute)(
			Schema.decodeUnknownSync(ProfileKey)(malformed),
			new AbortController().signal,
		),
	).rejects.toMatchObject({ _tag: "InputRejected" });
	expect(execute).not.toHaveBeenCalled();
});

it.each(["device", undefined])(
	"reset %s cancels a queued action across the desktop Promise and registered integration runtime",
	async (deviceId) => {
		const gate = () => {
			let resolve = () => {};
			const promise = new Promise<void>((done) => {
				resolve = done;
			});
			return { promise, resolve };
		};
		const blocked = gate(),
			entered = gate(),
			queued = gate();
		let executions = 0;
		const profiles = ManagedRuntime.make(profileLayer(key()));
		const manager = {
			webContents: { mainFrame: {} },
		} as unknown as BrowserWindow;
		vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(manager);
		const integrations = registerIntegrations({
			management: () => manager,
			rendererURL: "file:///app/index.html",
			profileRuntime: profiles,
			vault: fakeVault().port,
			openHa: async () => ({
				entities: async () => [
					{
						entity_id: config.entity_id,
						state: "off",
						attributes: {},
						area: "",
					},
				],
				services: async () => [
					{
						domain: "input_boolean",
						service: "toggle",
						name: "Toggle",
						fields: [],
					},
				],
				states: async () => [],
				execute: async () => {
					executions++;
					if (executions === 1) {
						entered.resolve();
						await blocked.promise;
					}
				},
				close: () => {},
			}),
		});
		const port = desktopKeyRuntimePort(
			() => undefined,
			() => {},
			false,
			integrationKeyAction((...args) => {
				queued.resolve();
				return integrations.executeHaFromKey(...args);
			}),
		).pipe(Layer.provide(profileLayer(key())));
		const keys = ManagedRuntime.make(
			KeyRuntime.DefaultWithoutDependencies.pipe(Layer.provide(port)),
		);
		let first: Promise<void> | undefined;
		try {
			const handler = vi
				.mocked(ipcMain.handle)
				.mock.calls.find(([channel]) => channel === INTEGRATIONS_REQUEST)?.[1];
			if (!handler) throw new Error("Missing integration IPC");
			const connected: IntegrationReply = await handler(
				{
					sender: manager.webContents,
					senderFrame: Object.assign(manager.webContents.mainFrame, {
						url: "file:///app/index.html",
					}),
				} as Parameters<typeof handler>[0],
				{
					type: "ha.connect",
					origin: "https://ha.test",
					token: "synthetic-only",
				},
			);
			expect(connected).toMatchObject({
				type: "ha",
				snapshot: { state: "Connected" },
			});
			first = integrations.executeHaFromKey(
				config,
				new AbortController().signal,
			);
			await entered.promise;
			const activation = keys.runPromiseExit(
				KeyRuntime.activate("device", "1,1", "press", expected),
			);
			await queued.promise;
			await keys.runPromise(KeyRuntime.reset(deviceId));
			const exit = await activation;
			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure")
				expect(Cause.isInterrupted(exit.cause)).toBe(true);
			blocked.resolve();
			await first;
			// A later action drains the same semaphore, proving the canceled one never ran.
			await keys.runPromise(
				KeyRuntime.activate("device", "1,1", "press", expected),
			);
			expect(executions).toBe(2);
		} finally {
			blocked.resolve();
			await first;
			await keys.dispose();
			await integrations.dispose();
			await profiles.dispose();
		}
	},
);
