import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { HardwareControls, QuakeDevice } from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import { Effect, Either, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { KnobModelPorts } from "../../../../../packages/device/src/knob/model/ports.js";
import { KnobModel } from "../../../../../packages/device/src/knob/model/service.js";
import {
	createEmptyProfileKey,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { createDesktopDiagnostics } from "../diagnostics";
import { desktopKnobAdapters } from "./desktop-adapters";
import { makeKnobRuntime } from "./index";

const fixture = (actions: readonly string[] = ["control+a", "control+b"]) => {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	return {
		schemaVersion: 1 as const,
		profiles: [
			{
				id: "p",
				name: "Synthetic",
				revision: 0,
				pages: [
					{
						id: "one",
						keys: [
							{
								...empty,
								childrenName: "hotkey",
								config: {
									...empty.config,
									type: "hotkey",
									display: true,
									supportKnob: true,
									actions: actions.map((value) => ({ type: "key", value })),
								},
							},
						],
					},
					{ id: "two", keys: [] },
				],
			},
		],
		activeByDevice: { device: { profileId: "p", pageId: "one" } },
	};
};
const setup = (actions?: readonly string[]) =>
	Effect.gen(function* () {
		const fake = yield* makeFakeHardwareTransport({ serial: "device" });
		const device = yield* QuakeDevice.pipe(
			Effect.provide(
				QuakeDevice.DefaultWithoutDependencies.pipe(Layer.provide(fake.layer)),
			),
		);
		const connection = yield* device.connect();
		const controls = yield* HardwareControls.pipe(
			Effect.provide(HardwareControls.Default),
		);
		const hardware = yield* controls.create(connection, {
			serial: "device",
			session: "hardware-1",
		});
		let currentHardware: typeof hardware | undefined = hardware;
		let serial = "device";
		let envelope: unknown = fixture(actions);
		let beforeRead = () => {};
		const adapter = desktopKnobAdapters(
			"/unused",
			{
				deviceId: () => serial,
				hardware: () => currentHardware,
			},
			{
				read: async () => {
					beforeRead();
					return envelope;
				},
				write: async () => {},
			},
		);
		const context = yield* adapter.load;
		const key = context.keys[0];
		if (!key) throw new Error("Missing fixture key");
		return {
			fake,
			hardware,
			adapter,
			context,
			key,
			turn: (delta: -1 | 1) => adapter.ports.focusedTurn(key, delta, context),
			setSerial: (value: string) => {
				serial = value;
			},
			setHardware: (value: typeof currentHardware) => {
				currentHardware = value;
			},
			setEnvelope: (value: typeof envelope) => {
				envelope = value;
			},
			beforeRead: (callback: () => void) => {
				beforeRead = callback;
			},
		};
	});
const run = <A, E>(
	program: Effect.Effect<A, E, import("effect").Scope.Scope>,
) => Effect.runPromise(Effect.scoped(program));

describe("focused knob hotkeys", () => {
	it("drives both detents from KnobModel through the committed profile to press/release HID bytes", async () => {
		await run(
			Effect.gen(function* () {
				const h = yield* setup();
				yield* Effect.gen(function* () {
					const model = yield* KnobModel;
					yield* model.configure(h.context);
					// Registration refresh keeps the model session when committed content is unchanged.
					const refreshed = yield* h.adapter.load;
					expect(refreshed.session.sessionId).not.toBe(
						h.context.session.sessionId,
					);
					yield* model.synchronize(refreshed);
					const send = (
						input:
							| { _tag: "TapTile"; keyCode: string }
							| { _tag: "Rotate"; delta: -1 | 1 },
					) =>
						model.dispatch({
							...input,
							sessionId: h.context.session.sessionId,
						});
					yield* send({ _tag: "TapTile", keyCode: "1,1" });
					yield* send({ _tag: "Rotate", delta: -1 });
					yield* send({ _tag: "Rotate", delta: 1 });
					expect(
						(yield* h.fake.writes).map((bytes) => [...bytes.slice(3, 8)]),
					).toEqual([
						[1, 16, 1, 1, 4],
						[1, 16, 0, 1, 4],
						[1, 16, 1, 1, 5],
						[1, 16, 0, 1, 5],
					]);
					const snapshot = yield* model.snapshot();
					expect(snapshot.focus).toEqual({
						_tag: "tile",
						keyCode: "1,1",
						angle: 0,
					});
					expect(snapshot.notice).toBe("");
					expect(snapshot.selector.mode).toBe("closed");
				}).pipe(
					Effect.provide(
						KnobModel.DefaultWithoutDependencies.pipe(
							Layer.provide(Layer.succeed(KnobModelPorts, h.adapter.ports)),
						),
					),
				);
			}),
		);
	});
	it.each([
		"serial",
		"profile",
		"page",
		"revision",
		"content",
		"hidden",
		"hardware",
	])("rejects stale %s without sending a chord", async (change) => {
		await run(
			Effect.gen(function* () {
				const h = yield* setup();
				const envelope = fixture();
				if (change === "serial") h.beforeRead(() => h.setSerial("other"));
				if (change === "hardware") h.beforeRead(() => h.setHardware(undefined));
				if (change === "profile")
					envelope.activeByDevice.device.profileId = "other";
				if (change === "page") envelope.activeByDevice.device.pageId = "two";
				const profile = envelope.profiles[0];
				const key = profile?.pages[0]?.keys[0];
				const action = key?.config.actions[1];
				if (!profile || !action) throw new Error("Missing fixture action");
				if (change === "revision") profile.revision++;
				if (change === "content") action.value = "control+c";
				if (change === "hidden") {
					h.setEnvelope({
						...envelope,
						manager: {
							revision: 0,
							installed: true,
							hidden: ["p"],
							links: [],
							approvedCommands: [],
							userHasSetDefault: false,
						},
					});
				} else h.setEnvelope(envelope);
				const result = yield* Effect.either(h.turn(1));
				expect(Either.isLeft(result) && result.left.code).toBe(
					"QUAKE.KNOB.SESSION_STALE",
				);
				expect(yield* h.fake.writes).toEqual([]);
			}),
		);
	});
	it.each([["control+a"], ["control+a", "invalid+secret"], ["", "control+b"]])(
		"validates both saved actions before any IO: %j",
		async (...actions) => {
			await run(
				Effect.gen(function* () {
					const h = yield* setup(actions);
					const result = yield* Effect.either(h.turn(-1));
					expect(Either.isLeft(result) && result.left.code).toBe(
						"QUAKE.KNOB.CONFIG_INVALID",
					);
					expect(yield* h.fake.writes).toEqual([]);
				}),
			);
		},
	);
	it("reports missing hardware without sending a chord", async () => {
		await run(
			Effect.gen(function* () {
				const h = yield* setup();
				h.setHardware(undefined);
				const result = yield* Effect.either(h.turn(1));
				expect(Either.isLeft(result) && result.left.code).toBe(
					"QUAKE.KNOB.CAPABILITY_UNAVAILABLE",
				);
				expect(yield* h.fake.writes).toEqual([]);
			}),
		);
	});
	it("rejects a hardware serial that doesn't own the profile context", async () => {
		await run(
			Effect.gen(function* () {
				const h = yield* setup();
				h.setHardware({
					...h.hardware,
					snapshot: () =>
						h.hardware
							.snapshot()
							.pipe(
								Effect.map((snapshot) => ({ ...snapshot, serial: "other" })),
							),
				});
				const result = yield* Effect.either(h.turn(1));
				expect(Either.isLeft(result) && result.left.code).toBe(
					"QUAKE.KNOB.SESSION_STALE",
				);
				expect(yield* h.fake.writes).toEqual([]);
			}),
		);
	});
	it("retains the original keyboard failure and never falls back to host input", async () => {
		await run(
			Effect.gen(function* () {
				const h = yield* setup();
				yield* h.hardware.setInputMode("host");
				const result = yield* Effect.either(h.turn(1));
				expect(Either.isLeft(result)).toBe(true);
				if (Either.isRight(result)) return;
				expect(result.left.code).toBe("QUAKE.KNOB.DISPATCH_FAILED");
				expect(result.left.originalCause).toMatchObject({
					_tag: "HostActionFailed",
					originalCause: "host-keyboard-unavailable",
				});
				expect(JSON.stringify(result.left)).not.toContain(
					"host-keyboard-unavailable",
				);
				expect(yield* h.fake.writes).toEqual([]);
			}),
		);
	});
	it("retains the hardware and native cause chain on write failure", async () => {
		await run(
			Effect.gen(function* () {
				const h = yield* setup();
				const source = Object.assign(new Error("secret user content"), {
					code: "EACCES",
				});
				yield* h.fake.failWrite(source);
				const result = yield* Effect.either(h.turn(1));
				expect(Either.isLeft(result)).toBe(true);
				if (Either.isRight(result)) return;
				expect(result.left.code).toBe("QUAKE.KNOB.DISPATCH_FAILED");
				const host = result.left.originalCause;
				expect(host).toHaveProperty("_tag", "HostActionFailed");
				if (typeof host !== "object" || host === null) return;
				const hardware = Reflect.get(host, "originalCause");
				expect(
					typeof hardware === "object" &&
						hardware !== null &&
						Reflect.get(hardware, "_tag"),
				).toBe("HardwareUnavailable");
				if (typeof hardware !== "object" || hardware === null) return;
				const hid = Reflect.get(hardware, "originalCause");
				expect(
					typeof hid === "object" && hid !== null && Reflect.get(hid, "_tag"),
				).toBe("QuakeHidWriteFailed");
				if (typeof hid !== "object" || hid === null) return;
				expect(Reflect.get(hid, "originalCause") === source).toBe(true);
				expect(JSON.stringify(result.left)).not.toContain(
					"secret user content",
				);
			}),
		);
	});
});

it("persists the failed knob/keyboard/HID spans with one trace and scrubbed original causes", async () => {
	const directory = await mkdtemp(
		join(
			process.env.TMPDIR ??
				"/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-finish/tmp",
			"knob-diagnostics-",
		),
	);
	const diagnostics = createDesktopDiagnostics({ directory });
	try {
		await run(
			Effect.gen(function* () {
				const h = yield* setup();
				yield* h.fake.failWrite(
					Object.assign(new Error("private-knob-payload control+a"), {
						code: "EACCES",
					}),
				);
				const runtime = makeKnobRuntime(h.adapter.ports, diagnostics);
				yield* Effect.promise(async () => {
					try {
						await runtime.runPromise(KnobModel.configure(h.context));
						await runtime.runPromise(
							KnobModel.dispatch({
								_tag: "TapTile",
								sessionId: h.context.session.sessionId,
								keyCode: "1,1",
							}),
						);
						const exit = await runtime.runPromiseExit(
							KnobModel.dispatch({
								_tag: "Rotate",
								sessionId: h.context.session.sessionId,
								delta: -1,
							}),
						);
						expect(exit._tag).toBe("Failure");
						const snapshot = await runtime.runPromise(KnobModel.snapshot());
						expect(snapshot.notice).toBe("QUAKE.KNOB.DISPATCH_FAILED");
						expect(snapshot.focus).toEqual({
							_tag: "tile",
							keyCode: "1,1",
							angle: 0,
						});
					} finally {
						await runtime.dispose();
					}
				});
			}),
		);
		await diagnostics.close();
		const records: Array<Record<string, unknown>> = [];
		let persisted = "";
		for (const file of await readdir(directory)) {
			if (!/^diagnostics\.\d\.ndjson$/.test(file)) continue;
			const text = await readFile(join(directory, file), "utf8");
			persisted += text;
			for (const line of text.trim().split("\n"))
				if (line) records.push(JSON.parse(line));
		}
		const focused = records.find(
			(record) => record.span_name === "DesktopKnob.focusedHotkey",
		);
		const keyboard = records.find(
			(record) => record.span_name === "HardwareKeyboard.pressChord",
		);
		const dispatch = records.find(
			(record) =>
				record.span_name === "KnobModel.dispatch" &&
				record.outcome === "failure",
		);
		expect(focused).toMatchObject({
			outcome: "failure",
			cause: {
				kind: "Fail",
				error: {
					code: "QUAKE.KNOB.DISPATCH_FAILED",
					cause: {
						code: "QUAKE.ACTION.HOST_FAILED",
						cause: {
							code: "QUAKE.HARDWARE.UNAVAILABLE",
							cause: {
								code: "QUAKE.HID.WRITE_FAILED",
								cause: { sourceCode: "EACCES" },
							},
						},
					},
				},
			},
		});
		expect(focused?.trace_id).toBe(dispatch?.trace_id);
		expect(focused?.parent_span_id).toBe(dispatch?.span_id);
		expect(keyboard?.trace_id).toBe(focused?.trace_id);
		expect(keyboard?.parent_span_id).toBe(focused?.span_id);
		expect(focused?.request_id).toBe(dispatch?.request_id);
		expect(typeof focused?.trace_id).toBe("string");
		expect(typeof focused?.request_id).toBe("string");
		expect(persisted).not.toContain("private-knob-payload");
		expect(persisted).not.toContain("control+a");
	} finally {
		await diagnostics.close();
		await rm(directory, { recursive: true, force: true });
	}
});
