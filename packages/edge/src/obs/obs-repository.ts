import { Context, Effect, Redacted, Schema } from "effect";
import type {
	CredentialVault,
	JsonStore,
} from "../channels/channel-contracts.js";
import {
	emptyObsSaved,
	type ObsConnectionConfig,
	type ObsDetection,
	ObsSaved,
} from "./obs-contracts.js";
import {
	ObsConfigurationRejected,
	type ObsError,
	ObsStorageFailed,
} from "./obs-errors.js";
export class ObsStorage extends Context.Tag("obs/Storage")<
	ObsStorage,
	{
		readonly store: JsonStore;
		readonly vault: CredentialVault;
		readonly detect: () => Promise<ObsDetection | undefined>;
	}
>() {}
export class ObsRepository extends Effect.Service<ObsRepository>()(
	"obs/Repository",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const ports = yield* ObsStorage;
			const lock = yield* Effect.makeSemaphore(1);
			const read = Effect.fn("ObsRepository.read")(
				function* (): Effect.fn.Return<ObsSaved, ObsError> {
					const raw = yield* Effect.tryPromise({
						try: ports.store.read,
						catch: (cause) => new ObsStorageFailed(cause),
					});
					return yield* Schema.decodeUnknown(ObsSaved)(raw).pipe(
						Effect.catchTag("ParseError", (cause) =>
							Effect.fail(new ObsStorageFailed(cause)),
						),
					);
				},
			);
			const write = (config: ObsSaved) =>
				Effect.tryPromise({
					try: () => ports.store.write(config),
					catch: (cause) => new ObsStorageFailed(cause),
				});
			const saveUnlocked = Effect.fn("ObsRepository.saveUnlocked")(
				(
					config: ObsConnectionConfig,
					password: Redacted.Redacted<string> | undefined,
					manualOverride = true,
				): Effect.Effect<ObsSaved, ObsError> =>
					Effect.gen(function* () {
						const old = yield* read();
						let reference = old.credentialRef;
						if (password !== undefined) {
							reference =
								Redacted.value(password) === ""
									? ""
									: yield* Effect.tryPromise({
											try: () => ports.vault.put(Redacted.value(password)),
											catch: (cause) => new ObsStorageFailed(cause),
										});
						}
						const next = {
							...config,
							credentialRef: reference,
							manualOverride,
						};
						yield* write(next).pipe(
							Effect.onError(() =>
								reference !== old.credentialRef && reference !== ""
									? Effect.promise(() => ports.vault.remove(reference)).pipe(
											Effect.ignore,
										)
									: Effect.void,
							),
						);
						if (old.credentialRef && old.credentialRef !== reference)
							yield* Effect.tryPromise({
								try: () => ports.vault.remove(old.credentialRef),
								catch: (cause) => new ObsStorageFailed(cause),
							}).pipe(Effect.ignore);
						return next;
					}).pipe(Effect.uninterruptible),
			);
			const save = Effect.fn("ObsRepository.save")(
				(
					config: ObsConnectionConfig,
					password: Redacted.Redacted<string> | undefined,
					manualOverride = true,
				) =>
					saveUnlocked(config, password, manualOverride).pipe(
						lock.withPermits(1),
					),
			);
			const password = Effect.fn("ObsRepository.password")(
				(
					config: ObsSaved,
				): Effect.Effect<Redacted.Redacted<string>, ObsError> =>
					config.credentialRef
						? Effect.tryPromise({
								try: () => ports.vault.get(config.credentialRef),
								catch: (cause) => new ObsStorageFailed(cause),
							}).pipe(Effect.map(Redacted.make))
						: Effect.succeed(Redacted.make("")),
			);
			const detect = Effect.fn("ObsRepository.detect")(
				function* (): Effect.fn.Return<
					{ readonly found: boolean; readonly source: string },
					ObsError
				> {
					const config = yield* read();
					if (config.manualOverride) return { found: false, source: "" };
					const detected = yield* Effect.tryPromise({
						try: ports.detect,
						catch: (cause) => new ObsStorageFailed(cause),
					});
					if (!detected) return { found: false, source: "" };
					if (
						!Number.isInteger(detected.port) ||
						detected.port < 1 ||
						detected.port > 65535
					)
						return yield* new ObsConfigurationRejected();
					yield* saveUnlocked(
						{
							...emptyObsSaved,
							autoConnect: config.autoConnect,
							port: detected.port,
						},
						Redacted.make(detected.password),
						false,
					);
					return { found: true, source: detected.source };
				},
				lock.withPermits(1),
			);
			return { read, save, password, detect };
		}),
	},
) {}
