import { HardwareControls, QuakeDevice } from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import { Effect, Exit, Layer, Scope } from "effect";
import { expect, it, vi } from "vitest";

type InvokeEvent = {
	sender: { id: number; mainFrame: { url: string } };
	senderFrame: object;
};
const ipc = vi.hoisted(() => ({
	handlers: new Map<
		string,
		(
			event: InvokeEvent,
			session: unknown,
			input: unknown,
		) => Promise<{ ok: boolean }>
	>(),
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (
			name: string,
			handler: (
				event: InvokeEvent,
				session: unknown,
				input: unknown,
			) => Promise<{ ok: boolean }>,
		) => ipc.handlers.set(name, handler),
		removeHandler: (name: string) => ipc.handlers.delete(name),
	},
}));

import type { StripMessage } from "../shared/strip-transport";
import {
	dispatchStripMessage,
	registerStripTransport,
	type StripMessageOwners,
} from "./strip-transport";

it("dispatches every recovered outbound operation into the serial's existing owners", async () => {
	const owners: StripMessageOwners = {
		press: vi.fn(async () => {}),
		active: vi.fn(async () => {}),
		gaming: vi.fn(async () => {}),
		chat: vi.fn(async () => {}),
		management: vi.fn(async () => {}),
	};
	const rows: readonly StripMessage[] = [
		...[0, 1, 2, 3]
			.map((keyAction) => ({ type: "press", keyAction, keyCode: "1,1" }))
			.filter(
				(value): value is Extract<StripMessage, { type: "press" }> =>
					value.keyAction === 0 ||
					value.keyAction === 1 ||
					value.keyAction === 2 ||
					value.keyAction === 3,
			),
		{
			type: "reportConfig",
			keyMatrix: { row: 2, col: 8 },
			appVersion: "1.0.21",
		},
		{ type: "reportActiveProfile", resourceId: "p", version: 2 },
		{ type: "modeSwitch", mode: "gaming", enable: true },
		{
			type: "clawBotChatRequest",
			keyCode: "1,1",
			data: { action: "send", type: "text", content: "hello" },
		},
		{ type: "clawBotChatRequest", keyCode: "1,1", data: { action: "stop" } },
		{
			type: "functionKeyPressed",
			functionName: "managementCenter",
			tabType: "agents",
		},
		{ type: "callback", keyCode: "1,1" },
	];
	for (const row of rows)
		expect(await dispatchStripMessage(owners, "A", row)).toBe(true);
	expect(owners.press).toHaveBeenCalledTimes(4);
	expect(owners.press).toHaveBeenLastCalledWith("A", "1,1", 3);
	expect(owners.active).toHaveBeenCalledWith("A", "p", 2);
	expect(owners.gaming).toHaveBeenCalledWith("A", true);
	expect(owners.chat).toHaveBeenCalledTimes(2);
	expect(owners.management).toHaveBeenCalledWith("agents");
	expect(
		await dispatchStripMessage(owners, "A", {
			type: "press",
			keyAction: 4,
			keyCode: "1,1",
		}),
	).toBe(false);
});

it("SCREEN-015 authenticates the renderer/session and requires configuration before serial-scoped actions", async () => {
	const scope = await Effect.runPromise(Scope.make());
	try {
		const hardware = await Effect.runPromise(
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
					)).create(yield* device.connect(), {
						serial: "A",
						session: "session-A",
					});
				}),
				scope,
			),
		);
		const owners: StripMessageOwners = {
			press: vi.fn(async () => {}),
			active: vi.fn(async () => {}),
			gaming: vi.fn(async () => {}),
			chat: vi.fn(async () => {}),
			management: vi.fn(async () => {}),
		};
		const dispose = registerStripTransport({
			renderer: "file:///app/index.html",
			serial: () => "A",
			hardware: () => hardware,
			owners,
		});
		const invoke = ipc.handlers.get("quake:strip-message");
		if (!invoke) throw new Error("Missing strip IPC");
		const mainFrame = { url: "file:///app/index.html?surface=panel" };
		const sender = { id: 42, mainFrame };
		const event = { sender, senderFrame: mainFrame };
		const press = { type: "press", keyAction: 0, keyCode: "1,1" };
		expect(await invoke(event, "session-A", press)).toEqual({ ok: false });
		expect(
			await invoke(
				{ ...event, senderFrame: { url: mainFrame.url } },
				"session-A",
				{
					type: "reportConfig",
					keyMatrix: { row: 2, col: 8 },
					appVersion: "0.0.0",
				},
			),
		).toEqual({ ok: false });
		expect(
			await invoke(event, "session-A", {
				type: "reportConfig",
				keyMatrix: { row: 2, col: 8 },
				appVersion: "0.0.0",
			}),
		).toEqual({ ok: true });
		for (const keyAction of [0, 1, 2, 3])
			expect(await invoke(event, "session-A", { ...press, keyAction })).toEqual(
				{ ok: true },
			);
		expect(owners.press).toHaveBeenLastCalledWith("A", "1,1", 3);
		expect(await invoke(event, "old-session", press)).toEqual({ ok: false });
		expect(owners.press).toHaveBeenCalledTimes(4);
		mainFrame.url = "file:///foreign.html";
		expect(await invoke(event, "session-A", press)).toEqual({ ok: false });
		expect(owners.press).toHaveBeenCalledTimes(4);

		dispose();
		expect(ipc.handlers.size).toBe(0);
	} finally {
		await Effect.runPromise(Scope.close(scope, Exit.void));
	}
});
