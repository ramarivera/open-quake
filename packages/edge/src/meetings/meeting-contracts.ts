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
export const Segment = Schema.Struct({
	id: Schema.NonEmptyString,
	speaker: Schema.String,
	startMs: Count,
	endMs: Count,
	text: Text,
});
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
	parentId: Schema.OptionFromNullOr(MeetingId),
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
	config: MeetingConfig,
});
export type MeetingRecord = typeof MeetingRecord.Type;
export const MeetingStore = Schema.Struct({
	version: Schema.Literal(1),
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
export const MeetingSnapshot = Schema.Struct({
	revision: Count,
	mic: Schema.OptionFromNullOr(Schema.Boolean),
	config: MeetingConfig,
	records: Schema.Array(MeetingRecord),
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
	Schema.TaggedStruct("action", { action: MeetingAction }),
	Schema.TaggedStruct("cancel", { id: MeetingId }),
	Schema.TaggedStruct("retry", { id: MeetingId }),
	Schema.TaggedStruct("regenerate", { id: MeetingId, template: TemplateId }),
	Schema.TaggedStruct("template", { id: MeetingId, template: TemplateId }),
	Schema.TaggedStruct("rename", {
		id: MeetingId,
		title: Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(100)),
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
