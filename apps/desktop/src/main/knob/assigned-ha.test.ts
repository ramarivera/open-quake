import { Effect, Either, Option, Schema } from "effect";
import { expect, it, vi } from "vitest";
import {
	emptyKnobResource,
	emptyKnobSlot,
	validateKnobResource,
} from "../../../../../packages/device/src/knob/knob-invariants";
import { committedKnob } from "../../../../../packages/device/src/knob/knob-profile";
import { KnobModel } from "../../../../../packages/device/src/knob/model/service";
import { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts";
import { inspectProfileImport } from "../../../../../packages/device/src/profiles/profile-import";
import { desktopKnobAdapters } from "./desktop-adapters";
import { makeKnobRuntime } from "./index";

vi.mock("electron", () => ({
	app: {},
	nativeImage: {},
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));
it("MGMT-213 imports saved HA configData and dispatches the committed center press once", async () => {
	const config = {
		entity_id: "light.desk",
		service: "toggle",
		service_data: { brightness: 40 },
		custom_display_type: "default",
		custom_display_settings: { fontSize: 24 },
		custom_display_detail: [],
	};
	const configData = ` ${JSON.stringify(config)}\n`;
	const knob = {
		...emptyKnobResource(),
		config: {
			...emptyKnobResource().config,
			display: true,
			subActions: [
				{
					childrenName: "homeAssistant",
					config: {
						type: "homeAssistant",
						actions: [{ type: "configData", value: configData }],
					},
				},
				emptyKnobSlot(),
				emptyKnobSlot(),
			],
		},
	};
	const profile = {
		id: "p",
		name: "HA",
		revision: 1,
		pages: [{ id: "one", keys: [] }],
		knob,
	};
	const imported = inspectProfileImport(profile).profile;
	expect(imported).toBeDefined();
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
		schemaVersion: 1,
		profiles: [imported],
		activeByDevice: { device: { profileId: "p", pageId: "one" } },
	});
	const savedProfile = envelope.profiles[0];
	if (!savedProfile) throw new Error("profile missing");
	const savedKnob = committedKnob(savedProfile);
	expect(
		savedKnob?._tag === "Some" &&
			savedKnob.value.config.subActions[0].config.actions[0]?.value,
	).toBe(configData);
	const calls: unknown[] = [];
	const adapter = desktopKnobAdapters(
		"/unused",
		{
			deviceId: () => "device",
			voice: () => Effect.die("HA press must not use voice"),
			homeAssistant: async (key, signal, isCurrent) => {
				expect(signal.aborted).toBe(false);
				expect(isCurrent()).toBe(true);
				calls.push(key);
			},
		},
		{
			read: async () => Schema.encodeSync(ProfileEnvelope)(envelope),
			write: async () => {},
		},
	);
	const context = await Effect.runPromise(adapter.load);
	const runtime = makeKnobRuntime(adapter.ports);
	try {
		await runtime.runPromise(KnobModel.configure(context));
		await runtime.runPromise(
			KnobModel.dispatch({
				_tag: "Key",
				sessionId: context.session.sessionId,
				code: 1,
			}),
		);
		expect(calls).toEqual([config]);
	} finally {
		await runtime.dispose();
	}
});

it.each([
	{},
	{ entity_id: "light.desk", service: "toggle" },
	{
		entity_id: "light.desk",
		service: "toggle",
		service_data: {},
		custom_display_type: "default",
		custom_display_settings: { fontSize: 99 },
		custom_display_detail: [],
	},
])("PR128 malformed imported HA object stays inert: %j", async (config) => {
	const knob = {
		...emptyKnobResource(),
		config: {
			...emptyKnobResource().config,
			display: true,
			subActions: [
				{
					childrenName: "homeAssistant",
					config: {
						type: "homeAssistant",
						actions: [{ type: "configData", value: JSON.stringify(config) }],
					},
				},
				emptyKnobSlot(),
				emptyKnobSlot(),
			],
		},
	};
	const imported = inspectProfileImport({
		id: "p",
		name: "bad HA",
		revision: 1,
		pages: [{ id: "one", keys: [] }],
		knob,
	}).profile;
	expect(imported).toBeDefined();
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
		schemaVersion: 1,
		profiles: [imported],
		activeByDevice: { device: { profileId: "p", pageId: "one" } },
	});
	expect(Either.isLeft(validateKnobResource(knob))).toBe(true);
	const saved = envelope.profiles[0];
	if (!saved) throw new Error("missing profile");
	expect(committedKnob(saved)).toEqual(Option.none());
	const calls: unknown[] = [];
	const adapter = desktopKnobAdapters(
		"/unused",
		{
			deviceId: () => "device",
			voice: () => Effect.void,
			homeAssistant: async (key) => {
				calls.push(key);
			},
		},
		{
			read: async () => Schema.encodeSync(ProfileEnvelope)(envelope),
			write: async () => {},
		},
	);
	const context = await Effect.runPromise(adapter.load);
	const runtime = makeKnobRuntime(adapter.ports);
	try {
		await runtime.runPromise(KnobModel.configure(context));
		await runtime.runPromise(
			KnobModel.dispatch({
				_tag: "Key",
				sessionId: context.session.sessionId,
				code: 1,
			}),
		);
		expect(calls).toEqual([]);
	} finally {
		await runtime.dispose();
	}
});
