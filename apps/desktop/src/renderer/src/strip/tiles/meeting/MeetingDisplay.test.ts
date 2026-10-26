import { Option, Schema } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { meetAiProfile } from "../../../../../main/test/strip-fixtures";
import { voiceFixtureEnvelope } from "../../../../../main/test/voice-fixtures";
import {
	defaultMeetingConfig,
	MeetingId,
	MeetingSnapshot,
} from "../../../../../shared/meeting-bridge";
import { ProfileEnvelope } from "../../../../../shared/profiles";
import { stripLayout } from "../../geometry";
import { previewVoiceContext } from "../../overlays/voice/voice-context";
import { selectStripPage } from "../../selection";
import { MeetingDisplay } from "./MeetingDisplay";

let snapshot: MeetingSnapshot;
vi.mock("../../../meetings/useMeetings", () => ({
	useMeetings: () => ({ snapshot, error: "" }),
	useMeetingNow: () => 10000,
}));

function fixture() {
	const id = MeetingId.make("00000000-0000-4000-8000-000000000001");
	const config = { ...defaultMeetingConfig, autoGenerate: false };
	snapshot = {
		revision: 1,
		mic: Option.some(true),
		config,
		records: [
			{
				id,
				parentId: Option.none(),
				title: "Manual recording",
				startedAt: 0,
				endedAt: Option.some(1000),
				state: "recorded",
				audio: "complete",
				transcription: "pending",
				summary: "pending",
				marks: [],
				transcript: [],
				minutes: "",
				template: "standard",
				appliedTemplate: Option.none(),
				provenance: Option.none(),
				errorCode: Option.none(),
				config,
			},
		],
		cooldowns: {},
		translations: [],
		translating: false,
		tab: "main",
		notice: "",
		mock: true,
	};
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)(
		voiceFixtureEnvelope(meetAiProfile, "fake"),
	);
	const { profile, page } = selectStripPage(envelope, "fake");
	const tile = stripLayout(profile, page).tiles[0];
	if (!tile) throw new Error("missing meeting tile");
	return {
		id,
		render: (
			meetingStages = previewVoiceContext.view.meetingStages,
			resetMeetings = previewVoiceContext.view.resetMeetings,
		) =>
			renderToStaticMarkup(
				createElement(MeetingDisplay, {
					tile,
					context: {
						now: undefined,
						hourFormat: "24h",
						voice: {
							...previewVoiceContext,
							view: {
								...previewVoiceContext.view,
								meetingStages,
								resetMeetings,
							},
						},
					},
				}),
			),
	};
}

it("shows recorded idle after a manual recording finishes merging", () => {
	const f = fixture();
	const progress = {
		_tag: "MeetingStage",
		serial: "fake",
		keyCode: "1,6",
		meetingId: f.id,
		stage: 1,
		status: 2,
	} as const;
	const markup = f.render(new Map([[f.id, progress]]));
	expect(markup).toContain('data-animation="idle"');
	expect(markup).toContain("Main meeting is off");
	expect(markup).not.toContain("Recording ended, uploading");
	expect(markup).not.toContain('data-animation="processing"');
});

it("late-mounted display renders the current stage from its meeting snapshot", () => {
	const f = fixture();
	snapshot = Schema.decodeUnknownSync(MeetingSnapshot)({
		...Schema.encodeSync(MeetingSnapshot)(snapshot),
		records: Schema.encodeSync(MeetingSnapshot)(snapshot).records.map((r) => ({
			...r,
			state: "processing",
		})),
		progress: { [f.id]: { stage: 3, status: 1 } },
	});
	const markup = f.render();
	expect(markup).toContain('data-meeting-stage="3"');
	expect(markup).toContain('data-meeting-status="1"');
	expect(markup).toContain("<p>Parsing</p>");
	expect(f.render(new Map(), new Set([f.id]))).not.toContain(
		"data-meeting-stage",
	);
	const live = f.render(
		new Map([
			[
				f.id,
				{
					_tag: "MeetingStage",
					serial: "fake",
					keyCode: "1,6",
					meetingId: f.id,
					stage: 4,
					status: 1,
				},
			],
		]),
	);
	expect(live).toContain('data-meeting-stage="4"');
});
