import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import fc from "fast-check";
import {
	MeetingId,
	type MeetingRecord,
	type Translation,
} from "./meeting-contracts.js";
import { defaultMeetingConfig } from "./meeting-defaults.js";
import { MeetingErrorSchema, meetingError } from "./meeting-errors.js";
import {
	appendTranslation,
	asrTimeout,
	exportArtifact,
	recoverRecord,
	timeline,
} from "./meeting-invariants.js";
import { summaryTemplates } from "./meeting-templates.js";

const record: MeetingRecord = {
	id: MeetingId.make("00000000-0000-4000-8000-000000000001"),
	parentId: Option.none(),
	title: "Review/Plan",
	startedAt: 0,
	endedAt: Option.some(1000),
	state: "processing",
	audio: "complete",
	transcription: "complete",
	summary: "processing",
	marks: [],
	transcript: [
		{ id: "1", speaker: "2", text: "Olá, 世界", startMs: 0, endMs: 1000 },
	],
	minutes: "# Décisions\n\nShip Friday.",
	template: "project-weekly",
	appliedTemplate: Option.none(),
	provenance: Option.none(),
	errorCode: Option.none(),
	config: defaultMeetingConfig,
};
describe("meeting invariants", () => {
	it("bounds translation characters, paragraphs, interim replacement and timeline", () => {
		fc.assert(
			fc.property(
				fc.array(fc.string({ maxLength: 5000 }), { maxLength: 250 }),
				(texts) => {
					let paragraphs: readonly Translation[] = [];
					texts.forEach((text, i) => {
						paragraphs = appendTranslation(paragraphs, {
							id: String(i),
							text,
							speaker: "1",
							final: true,
							at: i * 300,
						});
					});
					expect(paragraphs.length).toBeLessThanOrEqual(200);
					expect(
						paragraphs.reduce((n, p) => n + p.text.length, 0),
					).toBeLessThanOrEqual(64000);
					expect(paragraphs.every((p) => p.text.length <= 4000)).toBe(true);
					const slots = timeline(paragraphs);
					expect(slots.length).toBeLessThanOrEqual(8);
					expect(
						slots.every(
							(slot, i) => i === 0 || slot - (slots[i - 1] ?? 0) >= 3000,
						),
					).toBe(true);
				},
			),
			{ numRuns: 60 },
		);
		expect(
			timeline([
				{ id: "short", text: "x".repeat(49), at: 0, final: true, speaker: "" },
			]),
		).toEqual([]);
		expect(
			timeline([
				{ id: "long", text: "x".repeat(50), at: 0, final: true, speaker: "" },
			]),
		).toEqual([0]);
		const interim: Translation = {
			id: "a",
			text: "One",
			speaker: "1",
			final: false,
			at: 0,
		};
		const final = appendTranslation([interim], {
			...interim,
			text: "One final",
			final: true,
		});
		expect(final).toHaveLength(1);
		expect(appendTranslation(final, { ...interim, text: "stale" })).toEqual(
			final,
		);
	});
	it("uses recovered timeouts and exactly four templates", () => {
		expect(asrTimeout("dashscope", 1000000)).toBe(1620000);
		expect(asrTimeout("openai", 0)).toBe(180000);
		expect(asrTimeout("openai", 10000000)).toBe(1800000);
		expect(summaryTemplates.map((t) => t.id)).toEqual([
			"project-weekly",
			"standard",
			"executive",
			"interview",
		]);
	});
	it("recovers interrupted generation without losing transcript and exports UTF-8 text", () => {
		const recovered = recoverRecord(record);
		expect(recovered.state).toBe("interrupted");
		expect(recovered.summary).toBe("interrupted");
		expect(recovered.transcript).toEqual(record.transcript);
		expect(exportArtifact(record, "summary")).toEqual({
			name: "Review-Plan-summary.md",
			text: record.minutes,
		});
		expect(exportArtifact(record, "transcript")).toEqual({
			name: "Review-Plan-transcript.txt",
			text: "00:00:00  Speaker 2\nOlá, 世界",
		});
	});
	it("pins each catalog identity, retains the private cause and scrubs serialization", () => {
		const cause = new Error(
			"private transcript Bearer sk-secret https://user:password@provider.invalid",
		);
		const error = meetingError("TranscriptionFailed", cause);
		expect(error._tag).toBe("MeetingTranscriptionFailed");
		expect(error.originalCause).toBe(cause);
		expect(Schema.is(MeetingErrorSchema)(error)).toBe(true);
		const wire = JSON.stringify(error);
		expect(wire).toContain("QUAKE.MEETING.TRANSCRIPTION_FAILED");
		expect(wire).not.toMatch(/private|sk-secret|password|Bearer/);
		expect(Object.keys(error)).not.toContain("originalCause");
	});
});
