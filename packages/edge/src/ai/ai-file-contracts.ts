import { Schema } from "effect";
import { ProfileId } from "./ai-contracts.js";

const FileId = Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_-]{1,256}$/));
const Correlation = { requestId: Schema.UUID };
export const FileOperation = Schema.Union(
	Schema.TaggedStruct("upload", {
		name: Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_. -]{1,128}$/)),
		content: Schema.String.pipe(Schema.maxLength(1048576)),
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
			content: Schema.String.pipe(Schema.maxLength(1048576)),
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
		options: Schema.Array(
			Schema.Struct({ id: Schema.String, label: Schema.String }),
		),
	}),
);
export type ProviderListing = typeof ProviderListing.Type;
