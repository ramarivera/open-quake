import {
	Context,
	Effect,
	type Redacted,
	Schema,
	Redacted as Secret,
} from "effect";
import type { ProviderProfile } from "../ai-contracts.js";
import {
	type AiError,
	AiProtocolInvalid,
	isAiError,
	translateProviderFailure,
} from "../ai-errors.js";
import {
	FileMetadata,
	type FileRequest,
	FileResult,
} from "../ai-file-contracts.js";
export class AiFileAdapter extends Context.Tag(
	"@open-quake/edge/AiFileAdapter",
)<
	AiFileAdapter,
	{
		readonly execute: (
			profile: ProviderProfile,
			request: FileRequest,
			credential: Redacted.Redacted<string>,
			signal: AbortSignal,
		) => Effect.Effect<FileResult, AiError>;
	}
>() {}
export async function boundedText(response: Response): Promise<string> {
	if (!response.body) throw new AiProtocolInvalid();
	const reader = response.body.getReader();
	const decoder = new TextDecoder("utf-8", { fatal: true });
	let text = "";
	let bytes = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) return text + decoder.decode();
			bytes += next.value.length;
			if (bytes > 2097152) throw new AiProtocolInvalid();
			text += decoder.decode(next.value, { stream: true });
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
export function makeFileAdapter(
	fetcher: typeof fetch = globalThis.fetch,
): typeof AiFileAdapter.Service {
	return {
		execute: Effect.fn("ProviderFiles.execute")(
			(profile, request, credential, signal) =>
				Effect.tryPromise({
					try: async (): Promise<FileResult> => {
						const operation = request.operation;
						const suffix =
							"fileId" in operation
								? `/${encodeURIComponent(operation.fileId)}${operation._tag === "content" ? "/content" : ""}`
								: "";
						const headers = new Headers({
							authorization: `Bearer ${Secret.value(credential)}`,
						});
						let body: FormData | undefined;
						if (operation._tag === "upload") {
							body = new FormData();
							body.append("purpose", "assistants");
							body.append(
								"file",
								new Blob([operation.content], { type: "text/plain" }),
								operation.name,
							);
						}
						const response = await fetcher(
							`${profile.baseUrl.replace(/\/$/, "")}/files${suffix}`,
							{
								headers,
								...(body ? { body } : {}),
								method:
									operation._tag === "upload"
										? "POST"
										: operation._tag === "delete"
											? "DELETE"
											: "GET",
								redirect: "error",
								signal,
							},
						);
						if (!response.ok)
							throw translateProviderFailure(response.status, undefined);
						const text = await boundedText(response);
						let result: FileResult["result"];
						if (operation._tag === "content")
							result = { _tag: "content", content: text };
						else if (operation._tag === "list")
							result = {
								_tag: "list",
								files: Schema.decodeUnknownSync(
									Schema.parseJson(
										Schema.Struct({
											data: Schema.Array(FileMetadata).pipe(
												Schema.maxItems(1000),
											),
										}),
									),
								)(text).data,
							};
						else if (operation._tag === "delete") {
							const deleted = Schema.decodeUnknownSync(
								Schema.parseJson(
									Schema.Struct({
										id: Schema.String,
										deleted: Schema.Literal(true),
									}),
								),
							)(text);
							if (deleted.id !== operation.fileId)
								throw new AiProtocolInvalid();
							result = {
								_tag: "deleted",
								fileId: operation.fileId,
								deleted: true,
							};
						} else
							result = {
								_tag: "metadata",
								file: Schema.decodeUnknownSync(Schema.parseJson(FileMetadata))(
									text,
								),
							};
						if (
							operation._tag === "retrieve" &&
							result._tag === "metadata" &&
							result.file.id !== operation.fileId
						)
							throw new AiProtocolInvalid();
						return Schema.decodeUnknownSync(FileResult)({
							requestId: request.requestId,
							result,
						});
					},
					catch: (cause) =>
						isAiError(cause) ? cause : new AiProtocolInvalid(cause),
				}),
		),
	};
}
