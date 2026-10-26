import { Schema } from "effect";
import { ProfileId } from "../ai/ai-contracts.js";

const Count = Schema.Int.pipe(Schema.nonNegative());
const Text = Schema.String.pipe(Schema.maxLength(1_000_000));
export const MeetingId = Schema.UUID.pipe(Schema.brand("MeetingId"));
export type MeetingId = typeof MeetingId.Type;
export const TemplateId = Schema.Literal(
	"project-weekly",
	"standard",
	"executive",
	"interview",
);
export type TemplateId = typeof TemplateId.Type;
export const titleWeight = (title: string): number =>
	Array.from(title).reduce(
		(weight, character) =>
			weight + ((character.codePointAt(0) ?? 0) <= 127 ? 1 : 2),
		0,
	);
export const MeetingTitle = Schema.NonEmptyTrimmedString.pipe(
	Schema.filter((title) => titleWeight(title) <= 100, {
		message: () => "Meeting title must be at most 100 weighted characters",
	}),
);
export const Word = Schema.Struct({ text: Text, startMs: Count, endMs: Count });
export const Segment = Schema.Struct({
	id: Schema.NonEmptyString,
	speaker: Schema.String,
	startMs: Count,
	endMs: Count,
	text: Text,
	words: Schema.optional(Schema.Array(Word).pipe(Schema.maxItems(20000))),
}).pipe(
	Schema.filter(
		(segment) =>
			segment.endMs >= segment.startMs &&
			(segment.words ?? []).every(
				(word, index, words) =>
					word.startMs >= segment.startMs &&
					word.endMs >= word.startMs &&
					word.endMs <= segment.endMs &&
					(index === 0 || word.startMs >= (words[index - 1]?.endMs ?? 0)),
			),
	),
);
export type Segment = typeof Segment.Type;
export const Mark = Schema.Struct({
	startMs: Count,
	endMs: Schema.OptionFromNullOr(Count),
});
export type Mark = typeof Mark.Type;
export const TaskState = Schema.Literal(
	"pending",
	"processing",
	"complete",
	"failed",
	"interrupted",
);
export type TaskState = typeof TaskState.Type;
export const MeetingConfig = Schema.Struct({
	profileId: ProfileId,
	asrProvider: Schema.Literal("dashscope", "openai", "mock"),
	asrModel: Schema.NonEmptyTrimmedString,
	minutesModel: Schema.NonEmptyTrimmedString,
	outputLanguage: Schema.NonEmptyTrimmedString,
	translationModel: Schema.NonEmptyTrimmedString,
	targetLanguage: Schema.NonEmptyTrimmedString,
	microphoneId: Schema.NonEmptyString,
	systemAudio: Schema.Boolean,
	autoGenerate: Schema.Boolean,
});
export type MeetingConfig = typeof MeetingConfig.Type;
export const MeetingRecord = Schema.Struct({
	id: MeetingId,
	parentId: Schema.OptionFromNullOr(Schema.Union(MeetingId, Count)),
	title: Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(100)),
	startedAt: Count,
	endedAt: Schema.OptionFromNullOr(Count),
	state: Schema.Literal(
		"recording",
		"recorded",
		"processing",
		"completed",
		"cancelled",
		"failed",
		"interrupted",
	),
	processingAttempt: Schema.optional(Count),
	audio: TaskState,
	transcription: TaskState,
	summary: TaskState,
	marks: Schema.Array(Mark),
	transcript: Schema.Array(Segment),
	minutes: Text,
	template: TemplateId,
	appliedTemplate: Schema.OptionFromNullOr(TemplateId),
	provenance: Schema.OptionFromNullOr(
		Schema.Struct({
			profileId: ProfileId,
			model: Schema.String,
			language: Schema.String,
			generatedAt: Count,
		}),
	),
	errorCode: Schema.OptionFromNullOr(Schema.String),
	attendeeCount: Schema.optional(Count),
	config: MeetingConfig,
});
export type MeetingRecord = typeof MeetingRecord.Type;
export const MeetingStore = Schema.Struct({
	version: Schema.Literal(1),
	summaryTemplate: Schema.optionalWith(TemplateId, {
		default: () => "project-weekly" as const,
	}),
	records: Schema.Array(MeetingRecord),
});
export type MeetingStore = typeof MeetingStore.Type;
export const Translation = Schema.Struct({
	id: Schema.NonEmptyString,
	speaker: Schema.String,
	text: Schema.String,
	final: Schema.Boolean,
	at: Count,
});
export type Translation = typeof Translation.Type;
export const MeetingStageState = Schema.Struct({
	stage: Count.pipe(Schema.lessThanOrEqualTo(5)),
	status: Count.pipe(Schema.lessThanOrEqualTo(2)),
});
export type MeetingStageState = typeof MeetingStageState.Type;
export const MeetingSnapshot = Schema.Struct({
	revision: Count,
	mic: Schema.OptionFromNullOr(Schema.Boolean),
	config: MeetingConfig,
	records: Schema.Array(MeetingRecord),
	progress: Schema.optional(
		Schema.Record({ key: Schema.String, value: MeetingStageState }),
	),
	cooldowns: Schema.Record({ key: Schema.String, value: Schema.Number }),
	translations: Schema.Array(Translation),
	translating: Schema.Boolean,
	tab: Schema.Literal("main", "temp", "live"),
	notice: Schema.String,
	mock: Schema.Boolean,
});
export type MeetingSnapshot = typeof MeetingSnapshot.Type;
export const MeetingAction = Schema.Literal(
	"meetingMinutes",
	"tempMeetingMinutes",
	"meetingRecordMark",
	"liveAudioTranslate",
	"mic",
);
export type MeetingAction = typeof MeetingAction.Type;
export const MeetingCommand = Schema.Union(
	Schema.TaggedStruct("read", {}),
	Schema.TaggedStruct("configure", { config: MeetingConfig }),
	Schema.TaggedStruct("action", {
		action: MeetingAction,
		keyCode: Schema.optional(
			Schema.String.pipe(Schema.pattern(/^\d{1,2},\d{1,2}$/)),
		),
	}),
	Schema.TaggedStruct("cancel", { id: MeetingId }),
	Schema.TaggedStruct("retry", { id: MeetingId }),
	Schema.TaggedStruct("regenerate", { id: MeetingId, template: TemplateId }),
	Schema.TaggedStruct("template", { id: MeetingId, template: TemplateId }),
	Schema.TaggedStruct("rename", {
		id: MeetingId,
		title: MeetingTitle,
	}),
	Schema.TaggedStruct("delete", {
		id: MeetingId,
		confirmed: Schema.Literal(true),
	}),
	Schema.TaggedStruct("export", {
		id: MeetingId,
		artifact: Schema.Literal("summary", "transcript"),
	}),
	Schema.TaggedStruct("reveal", { id: MeetingId }),
	Schema.TaggedStruct("tab", { tab: MeetingSnapshot.fields.tab }),
	Schema.TaggedStruct("clear", {}),
);
export type MeetingCommand = typeof MeetingCommand.Type;
export const MeetingReply = Schema.Union(
	Schema.TaggedStruct("ready", { snapshot: MeetingSnapshot }),
	Schema.TaggedStruct("failure", {
		code: Schema.String,
		message: Schema.String,
	}),
);
export type MeetingReply = typeof MeetingReply.Type;
