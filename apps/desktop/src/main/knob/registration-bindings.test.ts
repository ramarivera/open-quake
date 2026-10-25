import { Deferred, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { KnobModelContext } from "../../../../../packages/device/src/knob/model/contracts.js";
import { KnobModel } from "../../../../../packages/device/src/knob/model/service.js";
import { makeKnobRuntime, registerKnobRuntime } from "./index";

vi.mock("electron", () => ({
	app: {},
	nativeImage: {},
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));
const create = () =>
	makeKnobRuntime({
		selectProfile: () => Effect.never,
		focusedTurn: () => Effect.void,
		voice: () => Effect.void,
		readVolume: Effect.succeed({ level: 50, muted: false }),
		writeVolume: () => Effect.void,
		warmThumbnails: (p) => Effect.succeed(p),
	});
describe("knob registration binding lifecycle", () => {
	it("invalidates a ready catalog when the content/locale fingerprint changes, preserving identical commits", async () => {
		const runtime = create();
		const context = (await runtime.runPromise(KnobModel.snapshot())).context;
		let version = "initial";
		const registration = registerKnobRuntime(
			runtime,
			Effect.succeed(context),
			() => undefined,
			() => [],
			undefined,
			{ readVolume: Effect.never, contextVersion: () => version },
		);
		try {
			await registration.refresh();
			const ready: KnobModelContext = {
				...context,
				profiles: context.profiles.map((p) => ({
					...p,
					thumbnail: { _tag: "ready", dataUrl: "data:image/png;base64,YWJj" },
				})),
			};
			await runtime.runPromise(KnobModel.configure(ready));
			await registration.refresh();
			expect(
				(await runtime.runPromise(KnobModel.snapshot())).context.profiles[0]
					?.thumbnail._tag,
			).toBe("ready");
			version = "inactive-profile-edited";
			await registration.refresh();
			expect(
				(await runtime.runPromise(KnobModel.snapshot())).context.profiles.every(
					(p) => p.thumbnail._tag === "missing",
				),
			).toBe(true);
		} finally {
			await registration.dispose();
		}
	});
	it("interrupts an in-flight observation when its registration is disposed", async () => {
		const runtime = create();
		const initial = (await runtime.runPromise(KnobModel.snapshot())).context;
		const entered = await Effect.runPromise(Deferred.make<void>());
		let interrupted = false;
		const readVolume = Deferred.succeed(entered, undefined).pipe(
			Effect.zipRight(Effect.never),
			Effect.onInterrupt(() =>
				Effect.sync(() => {
					interrupted = true;
				}),
			),
		);
		const registration = registerKnobRuntime(
			runtime,
			Effect.succeed({ ...initial, player: true }),
			() => undefined,
			() => [],
			undefined,
			{ readVolume },
		);
		try {
			await registration.refresh();
			await runtime.runPromise(
				KnobModel.dispatch({
					_tag: "ToggleVolume",
					sessionId: initial.session.sessionId,
				}),
			);
			await Effect.runPromise(Deferred.await(entered));
			await registration.dispose();
			expect(interrupted).toBe(true);
		} finally {
			if (!interrupted) await registration.dispose();
		}
	});
});
