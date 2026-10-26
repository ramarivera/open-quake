import { Option, Schema } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { meetAiProfile } from "../../../../../main/test/strip-fixtures";
import { voiceFixtureEnvelope } from "../../../../../main/test/voice-fixtures";
import {
	defaultMeetingConfig,
	MeetingId,
	type MeetingSnapshot,
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

it("shows recorded idle after a manual recording finishes merging", () => {
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
	const progress = {
		_tag: "MeetingStage",
		serial: "fake",
		keyCode: "1,6",
		meetingId: id,
		stage: 1,
		status: 2,
	} as const;
	const markup = renderToStaticMarkup(
		createElement(MeetingDisplay, {
			tile,
			context: {
				now: undefined,
				hourFormat: "24h",
				voice: {
					...previewVoiceContext,
					view: {
						...previewVoiceContext.view,
						meetingStages: new Map([[id, progress]]),
					},
				},
			},
		}),
	);
	expect(markup).toContain('data-animation="idle"');
	expect(markup).toContain("Main meeting is off");
	expect(markup).not.toContain("Recording ended, uploading");
	expect(markup).not.toContain('data-animation="processing"');
});
