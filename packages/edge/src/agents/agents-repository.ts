import { Context, Effect, Option, Schema } from "effect";
import { AgentState } from "./agents-contracts.js";
import { type AgentError, AgentStorageFailed } from "./agents-errors.js";
import { initialAgentState } from "./agents-invariants.js";
export interface AgentStoragePort {
	readonly read: () => Effect.Effect<
		Option.Option<unknown>,
		AgentStorageFailed
	>;
	readonly write: (
		state: AgentState,
	) => Effect.Effect<void, AgentStorageFailed>;
}
export class AgentStorage extends Context.Tag("AgentStorage")<
	AgentStorage,
	AgentStoragePort
>() {}
export class AgentsRepository extends Effect.Service<AgentsRepository>()(
	"AgentsRepository",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const storage = yield* AgentStorage;
			const lock = yield* Effect.makeSemaphore(1);
			const load = Effect.fn("AgentsRepository.load")(
				function* (): Effect.fn.Return<AgentState, AgentStorageFailed> {
					const input = yield* storage.read();
					if (Option.isNone(input)) {
						const seed = initialAgentState();
						yield* storage.write(seed);
						return seed;
					}
					return yield* Schema.decodeUnknown(AgentState)(input.value).pipe(
						Effect.catchTag("ParseError", (cause) =>
							Effect.fail(new AgentStorageFailed(cause)),
						),
						Effect.flatMap((state) =>
							state.agents.filter((a) => a.id === "main").length === 1
								? Effect.succeed(state)
								: Effect.fail(new AgentStorageFailed()),
						),
					);
				},
			);
			return {
				read: Effect.fn("AgentsRepository.read")(
					(): Effect.Effect<AgentState, AgentStorageFailed> =>
						lock.withPermits(1)(load()),
				),
				transact: Effect.fn("AgentsRepository.transact")(
					(
						f: (state: AgentState) => Effect.Effect<AgentState, AgentError>,
					): Effect.Effect<AgentState, AgentError> =>
						lock.withPermits(1)(
							Effect.uninterruptibleMask((restore) =>
								Effect.gen(function* () {
									const before = yield* load();
									const next = yield* restore(f(before));
									if (next === before) return before;
									const committed = { ...next, revision: before.revision + 1 };
									yield* storage.write(committed);
									return committed;
								}),
							),
						),
				),
			};
		}),
	},
) {}
