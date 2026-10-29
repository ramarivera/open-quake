import { Option } from "effect";
import {
	duration,
	type MeetingRecord,
	type MeetingStageState,
} from "../../../shared/meeting-bridge";

export const stageLabels = [
	"Recording",
	"Recording ended, uploading",
	"Upload completed, ready to parse",
	"Parsing",
	"Parsing completed, generating minutes",
	"Minutes generation completed",
];
export function stageLabel(
	record: MeetingRecord,
	progress?: MeetingStageState,
): string {
	// MeetingStage 5 includes generation progress, so an unfinished summary wins.
	if (record.summary === "processing") return stageLabels[4] ?? "";
	if (progress && record.state !== "completed")
		return stageLabels[progress.stage] ?? "Unknown status";
	if (record.state === "recording") return stageLabels[0] ?? "";
	if (record.audio !== "complete") return stageLabels[1] ?? "";
	if (record.transcription === "pending") return stageLabels[2] ?? "";
	if (record.transcription !== "complete") return stageLabels[3] ?? "";
	return stageLabels[record.summary === "complete" ? 5 : 4] ?? "";
}
export function statusLabel(record: MeetingRecord): string {
	switch (record.state) {
		case "completed":
			return "Success";
		case "recording":
			return "Recording";
		case "processing":
			return "Processing";
		case "failed":
			return "Failed";
		case "interrupted":
			return "Needs attention";
		case "recorded":
			return "Recorded";
		case "cancelled":
			return "Cancelled";
	}
}
export const sortedMeetings = (records: readonly MeetingRecord[]) =>
	[...records].sort(
		(a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id),
	);
export function durationLabel(record: MeetingRecord, now: number): string {
	return Option.isNone(record.endedAt) &&
		record.state !== "recording" &&
		!record.transcript.some((segment) => segment.endMs > 0)
		? "Unknown duration"
		: `${Math.max(1, Math.round(duration(record, now) / 60000))} min`;
}
export function attendeeLabel(record: MeetingRecord): string {
	const count = record.attendeeCount ?? 0;
	return count > 0 ? `${count} attendees` : "Attendees not recorded";
}
