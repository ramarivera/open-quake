import { expect, it } from "@effect/vitest";
import { QuakeDevice } from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import { Effect, Fiber, Layer, Option, Schema, TestClock } from "effect";
import {
	HardwareControls,
	type HardwareSession,
} from "../../../../../packages/device/src/hardware/hardware-service";
import {
	MeetingId,
	MeetingSnapshot,
} from "../../../../../packages/edge/src/meetings/meeting-contracts";
import { defaultMeetingConfig } from "../../../../../packages/edge/src/meetings/meeting-defaults";
import { meetingHardwareFeedback } from "./meeting-feedback";

const id = MeetingId.make("00000000-0000-4000-8000-000000000001");
const snapshot = (marked: boolean) =>
	Schema.decodeUnknownSync(MeetingSnapshot)({
		revision: marked ? 2 : 1,
		mic: true,
		config: defaultMeetingConfig,
		records: [
			{
				id,
				parentId: null,
				title: "Meeting",
				startedAt: 0,
				endedAt: null,
				state: "recording",
				audio: "processing",
				transcription: "pending",
				summary: "pending",
				marks: marked ? [{ startMs: 1, endMs: null }] : [],
				transcript: [],
				minutes: "",
				template: "standard",
				appliedTemplate: null,
				provenance: null,
				errorCode: null,
				config: defaultMeetingConfig,
			},
		],
		cooldowns: {},
		translations: [],
		translating: false,
		tab: "main",
		notice: "",
		mock: true,
	});
it.scoped(
	"AI-076 MAIN-022 accepted marks and completion sound once, with settings gating and original session identity",
	() =>
		Effect.gen(function* () {
			const fake = yield* makeFakeHardwareTransport({ serial: "A" });
			const device = yield* QuakeDevice.pipe(
				Effect.provide(
					QuakeDevice.DefaultWithoutDependencies.pipe(
						Layer.provide(fake.layer),
					),
				),
			);
			const controls = yield* HardwareControls.pipe(
				Effect.provide(HardwareControls.Default),
			);
			const connection = yield* device.connect();
			const session = yield* controls.create(connection, {
				serial: "A",
				session: "a1",
			});
			let current: HardwareSession = session;
			const feedback = meetingHardwareFeedback(() => current);
			const mark = yield* feedback
				.mark(snapshot(false), snapshot(true), "A")
				.pipe(Effect.fork);
			yield* TestClock.adjust(60);
			yield* Fiber.join(mark);
			expect(
				(yield* fake.writes).filter((b) => b[4] === 2 && b[5] !== 0),
			).toHaveLength(1);
			yield* feedback.mark(snapshot(false), snapshot(true), "A");
			yield* feedback.mark(snapshot(true), snapshot(true), "A");
			const origin = { serial: "A", keyCode: "1,1" };
			yield* feedback.stage({ meetingId: id, stage: 5, status: 1, origin });
			const completion = yield* feedback
				.stage({ meetingId: id, stage: 5, status: 2, origin })
				.pipe(Effect.fork);
			yield* TestClock.adjust(5000);
			yield* Fiber.join(completion);
			expect(
				(yield* fake.writes).filter((b) => b[4] === 2 && b[5] !== 0),
			).toHaveLength(6);
			yield* feedback.stage({ meetingId: id, stage: 5, status: 1, origin });
			yield* feedback.stage({ meetingId: id, stage: 5, status: 2, origin });
			const next = MeetingId.make("00000000-0000-4000-8000-000000000002");
			yield* feedback.stage({ meetingId: next, stage: 5, status: 1, origin });
			current = yield* controls.create(connection, {
				serial: "A",
				session: "a2",
			});
			yield* feedback.stage({ meetingId: next, stage: 5, status: 2, origin });
			yield* current.configure({
				...(yield* current.snapshot()).preferences,
				buzzerEnabled: false,
			});
			const muted = meetingHardwareFeedback(() => current);
			yield* muted.mark(snapshot(false), snapshot(true), "A");
			expect(
				(yield* fake.writes).filter((b) => b[4] === 2 && b[5] !== 0),
			).toHaveLength(6);
			expect(
				Option.isNone(snapshot(false).records[0]?.endedAt ?? Option.none()),
			).toBe(true);
		}),
);
