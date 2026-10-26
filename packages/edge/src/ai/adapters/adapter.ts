import { Context, type Effect, type Redacted, Stream } from "effect";
import type {
	InferenceRequest,
	NormalizedEvent,
	ProviderProfile,
} from "../ai-contracts.js";
import type { AiError } from "../ai-errors.js";
import type { ProviderOptions } from "../ai-workflow-contracts.js";

/** SDK types belong in the implementation, never in consumers. No retries after dispatch. */
export interface CompatibleAdapter {
	readonly open: (input: {
		readonly profile: ProviderProfile;
		readonly request: InferenceRequest;
		readonly providerOptions: ProviderOptions;
		readonly credential: Redacted.Redacted<string>;
		readonly signal: AbortSignal;
		readonly redirectPolicy: "error";
		readonly maxRetries: 0;
	}) => Effect.Effect<Stream.Stream<NormalizedEvent, AiError>, AiError>;
}
/** Bind VercelCompatibleAdapterLive at the host composition root for direct BYO-key inference. */
export class AiCompatibleAdapter extends Context.Tag(
	"@open-quake/edge/AiCompatibleAdapter",
)<AiCompatibleAdapter, CompatibleAdapter>() {}

/** Abort IO before async-generator return, which waits for an outstanding next(). */
export function abortableStream<A, E>(
	source: AsyncIterable<A>,
	onError: (cause: unknown) => E,
	abort: () => void,
): Stream.Stream<A, E> {
	return Stream.fromAsyncIterable(
		{
			[Symbol.asyncIterator]() {
				const iterator = source[Symbol.asyncIterator]();
				return {
					next: () => iterator.next(),
					return: async () => {
						abort();
						return iterator.return
							? iterator.return()
							: { done: true, value: undefined };
					},
				};
			},
		},
		onError,
	);
}
