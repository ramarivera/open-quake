import { Schema } from "effect";
import { ProfileId } from "./ai-contracts.js";

export const FILE_CONTENT_MAX_BYTES = 2097152;
const FileContent = Schema.String.pipe(
	Schema.maxLength(1048576),
	Schema.filter(
		(value) =>
			new TextEncoder().encode(value).byteLength <= FILE_CONTENT_MAX_BYTES,
	),
);
const FileId = Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_-]{1,256}$/));
const Correlation = { requestId: Schema.UUID };
export const FileOperation = Schema.Union(
	Schema.TaggedStruct("upload", {
		name: Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_. -]{1,128}$/)),
		content: FileContent,
	}),
	Schema.TaggedStruct("list", {}),
	Schema.TaggedStruct("retrieve", { fileId: FileId }),
	Schema.TaggedStruct("content", { fileId: FileId }),
	Schema.TaggedStruct("delete", { fileId: FileId }),
);
export const FileRequest = Schema.Struct({
	...Correlation,
	profileId: ProfileId,
	operation: FileOperation,
});
export type FileRequest = typeof FileRequest.Type;
export const PublicFileRequest = Schema.Struct({
	...Correlation,
	modelRowId: Schema.NonEmptyString,
	sessionId: Schema.UUID,
	operation: FileOperation,
});
export type PublicFileRequest = typeof PublicFileRequest.Type;
export const FileMetadata = Schema.Struct({
	id: FileId,
	filename: Schema.String.pipe(Schema.maxLength(256)),
	bytes: Schema.Int.pipe(Schema.nonNegative()),
	purpose: Schema.String.pipe(Schema.maxLength(64)),
});
export const FileResult = Schema.Struct({
	...Correlation,
	result: Schema.Union(
		Schema.TaggedStruct("metadata", { file: FileMetadata }),
		Schema.TaggedStruct("list", {
			files: Schema.Array(FileMetadata).pipe(Schema.maxItems(1000)),
		}),
		Schema.TaggedStruct("content", {
			content: FileContent,
		}),
		Schema.TaggedStruct("deleted", {
			fileId: FileId,
			deleted: Schema.Literal(true),
		}),
	),
});
export type FileResult = typeof FileResult.Type;

export const ProviderListing = Schema.Array(
	Schema.Struct({
		id: Schema.NonEmptyString,
		provider: Schema.String,
		modelId: Schema.String,
		available: Schema.Boolean,
		directCapable: Schema.Boolean,
		state: Schema.optional(Schema.Literal("ready", "needs-key", "invalid")),
		options: Schema.Array(
			Schema.Struct({ id: Schema.String, label: Schema.String }),
		),
	}),
);
export type ProviderListing = typeof ProviderListing.Type;
