import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer, Schema } from "effect";
import { expect, it } from "vitest";
import { KnobDispatchFailed } from "../../../../../packages/device/src/knob/knob-errors.js";
import { KnobModelPorts } from "../../../../../packages/device/src/knob/model/ports.js";
import { KnobModel } from "../../../../../packages/device/src/knob/model/service.js";
import {
	createEmptyProfileKey,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { createDesktopDiagnostics } from "../diagnostics";
import { desktopKnobAdapters } from "./desktop-adapters";
import { makeKnobRuntime } from "./index";

const fixture = () => {
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
								childrenName: "brightness",
								config: {
									...empty.config,
									type: "brightness",
									display: true,
									supportKnob: true,
								},
							},
						],
					},
				],
			},
		],
		activeByDevice: { device: { profileId: "p", pageId: "one" } },
	};
};
const setup = () => {
	let envelope = fixture();
	let serial = "device";
	let percent = 50;
	let fail = false;
	let onRead = () => {};
	const writes: number[] = [];
	const source = Object.assign(
		new Error("private brightness path /Users/private/display"),
		{ code: "EACCES" },
	);
	const adapter = desktopKnobAdapters(
		"/unused",
		{
			deviceId: () => serial,
			brightness: {
				read: Effect.sync(() => {
					onRead();
					return { target: "synthetic-display", percent, quantum: 1 };
				}),
				write: (_, next) =>
					Effect.suspend(() =>
						fail
							? Effect.fail(KnobDispatchFailed.fromCause(source))
							: Effect.sync(() => {
									writes.push(next);
									percent = next;
								}),
					),
			},
			readVolume: Effect.die("volume route must not run"),
			writeVolume: () => Effect.die("volume route must not run"),
		},
		{
			read: async () => envelope,
			write: async () => {
				throw new Error("profiles must not be written");
			},
		},
	);
	return {
		adapter,
		writes,
		source,
		setEnvelope: (next: typeof envelope) => {
			envelope = next;
		},
		replaceDevice: () => {
			serial = "replacement";
		},
		fail: () => {
			fail = true;
		},
		onRead: (callback: () => void) => {
			onRead = callback;
		},
	};
};
it("routes actual KnobModel focus and both detents only to the production brightness binding", async () => {
	const h = setup();
	await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const context = yield* h.adapter.load;
				const model = yield* KnobModel;
				yield* model.configure(context);
				yield* model.dispatch({
					_tag: "TapTile",
					sessionId: context.session.sessionId,
					keyCode: "1,1",
				});
				for (const delta of [-1, 1] as const)
					yield* model.dispatch({
						_tag: "Rotate",
						sessionId: context.session.sessionId,
						delta,
					});
				expect(h.writes).toEqual([45, 50]);
				expect((yield* model.snapshot()).notice).toBe("");
			}).pipe(
				Effect.provide(
					KnobModel.DefaultWithoutDependencies.pipe(
						Layer.provide(Layer.succeed(KnobModelPorts, h.adapter.ports)),
					),
				),
			),
		),
	);
});
it.each(["device", "committed-content", "quarantine"])(
	"revalidates %s after a native read before any mutation",
	async (kind) => {
		const h = setup();
		const context = await Effect.runPromise(h.adapter.load);
		const key = context.keys[0];
		if (!key) throw new Error("Missing key");
		h.onRead(() => {
			if (kind === "device") h.replaceDevice();
			else {
				const next = fixture();
				const profile = next.profiles[0];
				const committed = profile?.pages[0]?.keys[0];
				if (!profile || !committed) throw new Error("Missing fixture key");
				if (kind === "quarantine")
					committed.compatibility = {
						unsupported: true,
					};
				else profile.name = "changed";
				h.setEnvelope(next);
			}
		});
		const result = await Effect.runPromise(
			Effect.either(h.adapter.ports.focusedTurn(key, 1, context)),
		);
		expect(Either.isLeft(result) && result.left._tag).toBe("KnobSessionStale");
		expect(h.writes).toHaveLength(0);
	},
);
it("retains correlated brightness failures through real knob feedback and persisted diagnostics", async () => {
	const directory = await mkdtemp(join(tmpdir(), "brightness-diagnostics-"));
	const diagnostics = createDesktopDiagnostics({ directory });
	const h = setup();
	const runtime = makeKnobRuntime(h.adapter.ports, diagnostics);
	try {
		const context = await runtime.runPromise(h.adapter.load);
		h.fail();
		await runtime.runPromise(KnobModel.configure(context));
		await runtime.runPromise(
			KnobModel.dispatch({
				_tag: "TapTile",
				sessionId: context.session.sessionId,
				keyCode: "1,1",
			}),
		);
		const result = await runtime.runPromise(
			Effect.either(
				KnobModel.dispatch({
					_tag: "Rotate",
					sessionId: context.session.sessionId,
					delta: 1,
				}),
			),
		);
		expect(Either.isLeft(result) && result.left._tag).toBe(
			"KnobDispatchFailed",
		);
		expect(
			Either.isLeft(result) && result.left.originalCause === h.source,
		).toBe(true);
		const snapshot = await runtime.runPromise(KnobModel.snapshot());
		expect(snapshot.notice).toBe("QUAKE.KNOB.DISPATCH_FAILED");
		expect(snapshot.focus).toMatchObject({ angle: 0 });
		expect(h.writes).toHaveLength(0);
		await runtime.dispose();
		await diagnostics.close();
		const text = (
			await Promise.all(
				(
					await readdir(directory)
				)
					.filter((f) => f.endsWith(".ndjson"))
					.map((f) => readFile(join(directory, f), "utf8")),
			)
		).join("\n");
		const records = text
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		const focused = records.find(
			(r) => r.span_name === "DesktopKnob.focusedBrightness",
		);
		const step = records.find((r) => r.span_name === "DesktopBrightness.step");
		const dispatch = records.find(
			(r) => r.span_name === "KnobModel.dispatch" && r.outcome === "failure",
		);
		expect(focused).toMatchObject({
			outcome: "failure",
			cause: {
				error: {
					code: "QUAKE.KNOB.DISPATCH_FAILED",
					cause: { sourceCode: "EACCES" },
				},
			},
		});
		expect(step?.trace_id).toBe(dispatch?.trace_id);
		expect(focused?.trace_id).toBe(dispatch?.trace_id);
		expect(focused?.request_id).toBe(dispatch?.request_id);
		expect(text).not.toMatch(
			/synthetic-display|\/Users\/private|private brightness/,
		);
	} finally {
		await runtime.dispose();
		await diagnostics.close();
		await rm(directory, { recursive: true, force: true });
	}
});
