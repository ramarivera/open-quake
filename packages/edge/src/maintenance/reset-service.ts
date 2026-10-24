import { Context, Effect } from "effect";
import { BackupFailed, type ResetFailed } from "./maintenance-errors.js";
export class ResetPort extends Context.Tag("ResetPort")<
	ResetPort,
	{
		backup: () => Effect.Effect<boolean, BackupFailed>;
		confirmFailure: () => Effect.Effect<boolean, ResetFailed>;
		stopWriters: () => Effect.Effect<void, ResetFailed>;
		clearAndQuit: () => Effect.Effect<void, ResetFailed>;
	}
>() {}
export class DataReset extends Effect.Service<DataReset>()("DataReset", {
	effect: Effect.gen(function* () {
		const port = yield* ResetPort;
		let busy = false;
		return {
			run: Effect.fn("DataReset.run")(function* (
				backup: boolean,
			): Effect.fn.Return<boolean, ResetFailed> {
				if (busy) return false;
				busy = true;
				return yield* Effect.gen(function* () {
					if (backup) {
						const ok = yield* port.backup().pipe(
							Effect.timeoutFail({
								duration: 60000,
								onTimeout: () => new BackupFailed(),
							}),
							Effect.catchTag("BackupFailed", () => Effect.succeed(false)),
						);
						if (!ok && !(yield* port.confirmFailure())) return false;
					}
					yield* port.stopWriters();
					yield* port.clearAndQuit();
					return true;
				}).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							busy = false;
						}),
					),
				);
			}),
		};
	}),
}) {}
