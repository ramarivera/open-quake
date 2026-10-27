import {
	HardwareControls,
	HardwareReplyTimeout,
	type HardwareSession,
	QuakeDevice,
} from "@open-quake/device";
import {
	fakeHardwareReply,
	makeFakeHardwareTransport,
} from "@open-quake/device/hardware/fake";
import { Effect, Exit, Layer, Scope } from "effect";
import { expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));

import { ipcMain } from "electron";
import { createDeviceReadyReader, registerDeviceReady } from "./device-ready";
import type { DeviceBus } from "./deviceBus";

it.each([true, false])(
	"refreshes real hardware commands with optional firmware reply %s",
	async (versionReply) => {
		vi.useFakeTimers();
		const scope = await Effect.runPromise(Scope.make());
		try {
			const hardware = await Effect.runPromise(
				Scope.extend(
					Effect.gen(function* () {
						const fake = yield* makeFakeHardwareTransport({
							serial: "A",
							...(versionReply
								? {}
								: {
										onCommand: (c: { readonly cmdId: number }) =>
											c.cmdId === 46
												? []
												: [
														fakeHardwareReply(c.cmdId, [
															c.cmdId === 3 ? 1 : 128,
														]),
													],
									}),
						});
						const device = yield* QuakeDevice.pipe(
							Effect.provide(
								QuakeDevice.DefaultWithoutDependencies.pipe(
									Layer.provide(fake.layer),
								),
							),
						);
						const connection = yield* device.connect();
						return yield* (yield* HardwareControls.pipe(
							Effect.provide(HardwareControls.Default),
						)).create(connection, { serial: "A", session: "session-A" });
					}),
					scope,
				),
			);
			const bus: DeviceBus = {
				on: () => () => {},
				currentStatus: () => ({
					source: "mock",
					kind: "status",
					state: "connected",
				}),
				hardware: () => hardware,
			};
			const read = createDeviceReadyReader({
				bus: (serial) => (serial === "A" ? bus : undefined),
				rotation: () => 270,
				mock: true,
			});
			expect(await read("unknown")).toEqual({ _tag: "offline" });
			const refreshing = read("A");
			// Firmware retries still run through real HardwareControls, on a controlled timer.
			await vi.advanceTimersByTimeAsync(3000);
			expect(await refreshing).toEqual({
				_tag: "ready",
				snapshot: {
					serialNumber: "A",
					connected: true,
					deviceModel: "QUAKE_HID",
					connectionType: "mock",
					session: "session-A",
					...(versionReply ? { version: "1.0.21" } : {}),
					rotation: 270,
					keyMatrix: { row: 2, col: 8 },
				},
			});
			expect(await Effect.runPromise(hardware.snapshot())).toMatchObject({
				available: true,
				mic: true,
				luminance: versionReply ? 255 : 128,
			});
			if (versionReply) {
				const unknown = createDeviceReadyReader({
					bus: () => bus,
					rotation: () => undefined,
					mock: true,
				});
				const withoutDisplay = await unknown("A");
				expect(
					withoutDisplay._tag === "ready" && withoutDisplay.snapshot.rotation,
				).toBeUndefined();
			}
		} finally {
			await Effect.runPromise(Scope.close(scope, Exit.void));
			vi.useRealTimers();
		}
	},
);
it.each(["success", "failure", "defect"])(
	"suppresses obsolete %s when its device is replaced during refresh",
	async (outcome) => {
		let release = () => {};
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		let hardware: HardwareSession;
		const first = {
			refresh: () =>
				Effect.promise(() => pending).pipe(
					Effect.zipRight(
						outcome === "failure"
							? Effect.fail(new HardwareReplyTimeout())
							: outcome === "defect"
								? Effect.die("obsolete refresh defect")
								: Effect.void,
					),
				),
		};
		const second = { refresh: () => Effect.void };
		// Build the full session by using a real conductor, then override just the delayed refresh boundary.
		const scope = await Effect.runPromise(Scope.make());
		try {
			const real = await Effect.runPromise(
				Scope.extend(
					Effect.gen(function* () {
						const fake = yield* makeFakeHardwareTransport({ serial: "A" });
						const device = yield* QuakeDevice.pipe(
							Effect.provide(
								QuakeDevice.DefaultWithoutDependencies.pipe(
									Layer.provide(fake.layer),
								),
							),
						);
						return yield* (yield* HardwareControls.pipe(
							Effect.provide(HardwareControls.Default),
						)).create(yield* device.connect(), { serial: "A", session: "old" });
					}),
					scope,
				),
			);
			hardware = { ...real, ...first };
			const bus: DeviceBus = {
				on: () => () => {},
				currentStatus: () => ({
					source: "mock",
					kind: "status",
					state: "connected",
				}),
				hardware: () => hardware,
			};
			const read = createDeviceReadyReader({
				bus: () => bus,
				rotation: () => 0,
				mock: true,
			});
			const old = read("A");
			hardware = { ...real, ...second };
			release();
			expect(await old).toEqual({ _tag: "offline" });
		} finally {
			await Effect.runPromise(Scope.close(scope, Exit.void));
		}
	},
);

it("SETTINGS-090 rejects foreign renderer documents and never defaults management to another serial", async () => {
	vi.mocked(ipcMain.handle).mockClear();
	const sender = {
		id: 42,
		mainFrame: { url: "file:///app/index.html?surface=panel" },
	};
	const dispose = registerDeviceReady({
		renderer: "file:///app/index.html",
		bus: () => undefined,
		rotation: () => undefined,
		mock: true,
		panelSerial: () => "A",
		management: () => {
			throw new Error("Unexpected management fallback");
		},
	});
	const handler = vi.mocked(ipcMain.handle).mock.calls[0]?.[1];
	if (!handler) throw new Error("Missing readiness handler");
	expect(
		await Reflect.apply(handler, undefined, [
			{ sender, senderFrame: sender.mainFrame },
			"B",
		]),
	).toEqual({ _tag: "offline" });
	sender.mainFrame.url = "file:///foreign.html";
	expect(
		await Reflect.apply(handler, undefined, [
			{ sender, senderFrame: sender.mainFrame },
			"B",
		]),
	).toEqual({ _tag: "failure", code: "QUAKE.HARDWARE.REQUEST_DENIED" });
	dispose();
	expect(ipcMain.removeHandler).toHaveBeenCalledWith("quake:device-ready");
});
