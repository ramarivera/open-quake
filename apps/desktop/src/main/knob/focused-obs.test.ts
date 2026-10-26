import { Effect, Schema } from "effect";
import { expect, it, vi } from "vitest";
import { KnobModel } from "../../../../../packages/device/src/knob/model/service";
import {
	createEmptyProfileKey,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { desktopKnobAdapters } from "./desktop-adapters";
import { makeKnobRuntime } from "./index";

vi.mock("electron", () => ({
	app: {},
	nativeImage: {},
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));
it("focused knob rotation and press reach only committed OBS configuration", async () => {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const key = {
		...empty,
		childrenName: "obsVolume",
		config: {
			...empty.config,
			type: "obsVolume",
			display: true,
			supportKnob: true,
			actions: [
				{ type: "configData", value: '{"inputUuid":"microphone","step":0.05}' },
			],
		},
	};
	let envelope = {
		schemaVersion: 1,
		profiles: [
			{
				id: "p",
				name: "OBS",
				revision: 1,
				pages: [{ id: "one", keys: [key] }],
			},
		],
		activeByDevice: { device: { profileId: "p", pageId: "one" } },
	};
	const obs = vi.fn(
		async (
			_key: ProfileKey,
			_delta: -1 | 1 | undefined,
			_signal: AbortSignal,
		) => {},
	);
	const adapter = desktopKnobAdapters(
		"/unused",
		{ deviceId: () => "device", obs, voice: () => Effect.void },
		{ read: async () => envelope, write: async () => {} },
	);
	const context = await Effect.runPromise(adapter.load);
	const runtime = makeKnobRuntime(adapter.ports);
	try {
		await runtime.runPromise(KnobModel.configure(context));
		await runtime.runPromise(
			KnobModel.dispatch({
				_tag: "TapTile",
				sessionId: context.session.sessionId,
				keyCode: "1,1",
			}),
		);
		await runtime.runPromise(
			KnobModel.dispatch({
				_tag: "Rotate",
				sessionId: context.session.sessionId,
				delta: 1,
			}),
		);
		await runtime.runPromise(
			KnobModel.dispatch({
				_tag: "Key",
				sessionId: context.session.sessionId,
				code: 1,
			}),
		);
		expect(obs.mock.calls.map((call) => call[1])).toEqual([1, undefined]);
		expect(obs.mock.calls[0]?.[0].config.actions).toEqual(key.config.actions);
		envelope = {
			...envelope,
			profiles: envelope.profiles.map((profile) => ({
				...profile,
				revision: 2,
			})),
		};
		await expect(
			runtime.runPromise(
				KnobModel.dispatch({
					_tag: "Rotate",
					sessionId: context.session.sessionId,
					delta: -1,
				}),
			),
		).rejects.toThrow();
		expect(obs).toHaveBeenCalledTimes(2);
	} finally {
		await runtime.dispose();
	}
});
