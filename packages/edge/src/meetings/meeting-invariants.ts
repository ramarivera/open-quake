import { Option } from "effect";
import type {
	MeetingRecord,
	Segment,
	Translation,
} from "./meeting-contracts.js";

export const COOLDOWN_MS = 5000;
export const asrTimeout = (provider: string, durationMs: number): number =>
	provider === "openai"
		? Math.min(1800000, Math.max(180000, durationMs * 0.5 + 180000))
		: Math.max(180000, durationMs * 1.5 + 120000);
export const asrPlan = Object.freeze({
	channelIds: [0],
	diarization: true,
	pollMs: 10000,
	uploadExpiryMs: 48 * 60 * 60 * 1000,
});
export const duration = (record: MeetingRecord, now: number): number =>
	Math.max(
		0,
		Option.getOrElse(record.endedAt, () =>
			record.state === "recording"
				? now
				: record.startedAt +
					Math.max(0, ...record.transcript.map((s) => s.endMs)),
		) - record.startedAt,
	);
export const formatTimer = (ms: number): string =>
	[
		Math.floor(ms / 3600000),
		Math.floor(ms / 60000) % 60,
		Math.floor(ms / 1000) % 60,
	]
		.map((v) => String(v).padStart(2, "0"))
		.join(":");
export const transcriptText = (segments: readonly Segment[]): string =>
	segments
		.map((s) => `${formatTimer(s.startMs)}  Speaker ${s.speaker}\n${s.text}`)
		.join("\n\n");
export const exportArtifact = (
	record: MeetingRecord,
	artifact: "summary" | "transcript",
) => ({
	name: `${Array.from(record.title, (character) =>
		character.charCodeAt(0) < 32 ? "-" : character,
	)
		.join("")
		.replace(/[\\/:*?"<>|]/g, "-")
		.replace(
			/^\.+/,
			"-",
		)}-${artifact}.${artifact === "summary" ? "md" : "txt"}`,
	text:
		artifact === "summary" ? record.minutes : transcriptText(record.transcript),
});
export function appendTranslation(
	current: readonly Translation[],
	update: Translation,
): readonly Translation[] {
	const trimmed = { ...update, text: update.text.slice(0, 4000) };
	const index = current.findIndex((p) => p.id === update.id);
	if (index >= 0 && current[index]?.final) return current;
	const next =
		index < 0
			? [...current, trimmed]
			: current.map((p, i) => (i === index ? trimmed : p));
	let characters = 0;
	return next
		.slice(-200)
		.reverse()
		.filter((p) => {
			characters += p.text.length;
			return characters <= 64000;
		})
		.reverse();
}
export function timeline(
	paragraphs: readonly Translation[],
): readonly number[] {
	const slots: number[] = [];
	let characters = 0;
	for (const paragraph of paragraphs) {
		characters += paragraph.text.length + 1;
		const last = slots.at(-1);
		if (
			Math.ceil(characters / 50) >= 2 &&
			(last === undefined || paragraph.at - last >= 3000)
		) {
			slots.push(paragraph.at);
			if (slots.length > 8) slots.shift();
			characters = 0;
		}
	}
	return slots;
}
export const recoverRecord = (record: MeetingRecord): MeetingRecord =>
	record.state === "recording" || record.state === "processing"
		? {
				...record,
				state: "interrupted",
				errorCode: Option.some("QUAKE.MEETING.INTERRUPTED"),
				audio: record.audio === "processing" ? "interrupted" : record.audio,
				transcription:
					record.transcription === "processing"
						? "interrupted"
						: record.transcription,
				summary:
					record.summary === "processing" ? "interrupted" : record.summary,
			}
		: record;
export function markRanges(record: MeetingRecord, now: number) {
	if (Option.isSome(record.parentId)) return [];
	const limit = duration(record, now);
	return record.marks.flatMap((mark, index) => {
		const startMs = Math.min(mark.startMs, limit);
		const savedEnd = Option.getOrUndefined(mark.endMs);
		const open =
			savedEnd === undefined ||
			savedEnd <= mark.startMs ||
			savedEnd - mark.startMs > 183 * 86400000;
		const endMs = Math.min(open ? limit : savedEnd, limit);
		return endMs > startMs ? [{ index: index + 1, startMs, endMs, open }] : [];
	});
}
export const marked = (record: MeetingRecord, segment: Segment): boolean =>
	markRanges(record, record.startedAt + segment.endMs).some(
		(mark) => segment.endMs > mark.startMs && segment.startMs < mark.endMs,
	);
