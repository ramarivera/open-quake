import {
	HardwareCommand as CommandSchema,
	type HardwareCommand,
	type HardwareReply,
} from "@open-quake/protocol";
import {
	Cause,
	Deferred,
	Effect,
	Either,
	Exit,
	Fiber,
	Option,
	Ref,
	Schema,
	type Scope,
	Stream,
} from "effect";
import type { QuakeConnection } from "../device-service.js";
import {
	defaultHardwarePreferences,
	HardwarePreferences,
	type HardwareSnapshot,
	InputMode,
	type ToneName,
	ToneSequence,
} from "./hardware-contracts.js";
import {
	HardwareCommandRejected,
	type HardwareError,
	type HardwarePreferencesFailed,
	HardwareReplyTimeout,
	HardwareUnavailable,
} from "./hardware-errors.js";
import {
	buzzerTones,
	encodeDeviceChord,
	stepLuminance,
} from "./hardware-invariants.js";
import {
	HardwarePreferencesStore,
	MemoryHardwarePreferences,
} from "./hardware-repository.js";
import { importQmkOperations, qmkOperationBytes } from "./qmk-operations.js";

export type HardwareSession = Effect.Effect.Success<
	ReturnType<HardwareControls["create"]>
>;
export class HardwareControls extends Effect.Service<HardwareControls>()(
	"@open-quake/device/HardwareControls",
	{
		accessors: true,
		dependencies: [MemoryHardwarePreferences],
		effect: Effect.gen(function* () {
			const store = yield* HardwarePreferencesStore;
			// This is app-lifetime state. It deliberately is not persisted per serial.
			const inputMode = yield* Ref.make<InputMode>("device");
			const preferenceLock = yield* Effect.makeSemaphore(1);
			const creationLock = yield* Effect.makeSemaphore(1);
			const owners = new Map<
				string,
				{
					session: string;
					preferences: HardwarePreferences;
					dirty: boolean;
					mutationLock: Effect.Semaphore;
				}
			>();
			const create = Effect.fn("HardwareControls.create")(function* (
				connection: QuakeConnection,
				identity: { readonly serial: string; readonly session: string },
			): Effect.fn.Return<
				{
					readonly snapshot: () => Effect.Effect<HardwareSnapshot>;
					readonly qmk: (
						commands: readonly import("./qmk-operations.js").QmkOperation[],
					) => Effect.Effect<readonly (readonly number[])[], HardwareError>;
					readonly refresh: () => Effect.Effect<void, HardwareError>;
					readonly readVersion: () => Effect.Effect<string, HardwareError>;
					readonly enterDfu: () => Effect.Effect<void, HardwareError>;
					readonly toggleMic: () => Effect.Effect<void, HardwareError>;
					readonly stepBrightness: (
						direction: -1 | 1,
					) => Effect.Effect<void, HardwareError>;
					readonly configure: (
						input: unknown,
					) => Effect.Effect<void, HardwareError>;
					readonly setInputMode: (
						input: unknown,
					) => Effect.Effect<void, HardwareError>;
					readonly setLocked: (
						locked: boolean,
					) => Effect.Effect<void, HardwareError>;
					readonly send: (
						command: HardwareCommand,
					) => Effect.Effect<void, HardwareError>;
					readonly holdChord: (
						chord: string,
					) => Effect.Effect<Effect.Effect<void, HardwareError>, HardwareError>;
					readonly pressChord: (
						chord: string,
					) => Effect.Effect<void, HardwareError>;
					readonly playSequence: (
						input: unknown,
					) => Effect.Effect<void, HardwareError>;
					readonly setLongTone: (
						on: boolean,
					) => Effect.Effect<void, HardwareError>;
					readonly playTone: (
						name: ToneName,
					) => Effect.Effect<void, HardwareError>;
				},
				HardwareError,
				Scope.Scope
			> {
				if (!identity.serial || !identity.session)
					return yield* new HardwareUnavailable();
				const scope = yield* Effect.scope;
				const mutationLock = yield* Effect.makeSemaphore(1);
				const owner = yield* creationLock.withPermits(1)(
					Effect.suspend(() => {
						const previous = owners.get(identity.serial);
						return (previous?.mutationLock ?? mutationLock).withPermits(1)(
							preferenceLock.withPermits(1)(
								Effect.gen(function* () {
									const previous = owners.get(identity.serial);
									if (previous?.dirty) {
										yield* store.write(identity.serial, previous.preferences);
										previous.dirty = false;
									}
									const initial = yield* store.read(identity.serial);
									const next = {
										session: identity.session,
										mutationLock,
										preferences: Option.getOrElse(
											initial,
											() => defaultHardwarePreferences,
										),
										dirty: false,
									};
									owners.set(identity.serial, next);
									return next;
								}).pipe(Effect.uninterruptible),
							),
						);
					}),
				);
				let preferences = owner.preferences;
				let pendingStateSync = false;
				let stateSyncSuccess = false;
				let mic: boolean | undefined;
				let luminance: number | undefined;
				let firmware: HardwareSnapshot["firmware"];
				let active = true;
				let firmwareLocked = false;
				let lockCycle = false;
				let restoreKnobLed = false;
				let poisoned = false;
				let errorCode: string | undefined;
				let backgroundError: Option.Option<HardwarePreferencesFailed> =
					Option.none();
				let pending: Option.Option<{
					readonly matches: (reply: HardwareReply) => boolean;
					readonly result: Deferred.Deferred<HardwareReply, HardwareError>;
				}> = Option.none();
				const wireLock = yield* Effect.makeSemaphore(1);
				const toneLock = yield* Effect.makeSemaphore(1);
				const toneTransitionLock = yield* Effect.makeSemaphore(1);
				let toneClosing = false;
				let sequenceStop:
					| { stop: Deferred.Deferred<void>; done: Deferred.Deferred<void> }
					| undefined;
				let preview: Option.Option<Fiber.RuntimeFiber<void, never>> =
					Option.none();
				let longTone: Option.Option<Fiber.RuntimeFiber<void, never>> =
					Option.none();
				let saving: Option.Option<Fiber.RuntimeFiber<void, never>> =
					Option.none();
				const ensureActive = (): Effect.Effect<void, HardwareUnavailable> =>
					active &&
					owners.get(identity.serial) === owner &&
					!poisoned &&
					!firmwareLocked
						? Effect.void
						: Effect.fail(new HardwareUnavailable());
				const rawWrite = (
					command: HardwareCommand,
				): Effect.Effect<void, HardwareUnavailable> =>
					connection.sendHardware(command).pipe(
						Effect.matchEffect({
							onSuccess: () => Effect.void,
							onFailure: (cause) => Effect.fail(new HardwareUnavailable(cause)),
						}),
					);
				const stop = (cause: unknown): Effect.Effect<void> =>
					Effect.gen(function* () {
						active = false;
						if (Option.isSome(pending))
							yield* Deferred.fail(
								pending.value.result,
								new HardwareUnavailable(cause),
							);
					});
				const events = yield* connection.subscribe();
				yield* Stream.runForEach(events, (event) => {
					if (event._tag === "Disconnect") return stop(event.reason);
					if (
						event._tag === "HardwareReply" &&
						Option.isSome(pending) &&
						pending.value.matches(event.reply)
					)
						return Deferred.succeed(pending.value.result, event.reply).pipe(
							Effect.asVoid,
						);
					return Effect.void;
				}).pipe(
					Effect.matchEffect({
						onFailure: stop,
						onSuccess: () => stop("stream-ended"),
					}),
					Effect.forkScoped,
				);
				// Every set consumes its ack. Otherwise an LED/buzzer ack could confirm a later mic toggle.
				const exchange = (
					command: HardwareCommand,
				): Effect.Effect<HardwareReply, HardwareError> =>
					wireLock.withPermits(1)(
						Effect.gen(function* () {
							yield* ensureActive();
							const valid = Schema.decodeUnknownEither(CommandSchema)(command);
							if (Either.isLeft(valid))
								return yield* new HardwareUnavailable(valid.left);
							const result = yield* Deferred.make<
								HardwareReply,
								HardwareError
							>();
							const matches = (reply: HardwareReply): boolean =>
								command._tag !== "Query"
									? reply._tag === "Ack"
									: reply._tag ===
										{
											mic: "MicState",
											knobLed: "KnobLedState",
											luminance: "LuminanceState",
											version: "FirmwareVersion",
										}[command.feature];
							pending = Option.some({ matches, result });
							return yield* Effect.gen(function* () {
								yield* rawWrite(command);
								// A connection-scoped timer can fail the deferred even when the
								// caller masks interruption to commit an atomic lock transition.
								const timeout = yield* (
									command._tag === "Query" && command.feature === "version"
										? Effect.gen(function* () {
												for (let attempt = 1; attempt < 10; attempt++) {
													yield* Effect.sleep(300);
													if (yield* Deferred.isDone(result)) return;
													yield* rawWrite(command);
												}
												yield* Effect.sleep(300);
											}).pipe(
												Effect.catchTag("HardwareUnavailable", (error) =>
													Deferred.fail(result, error),
												),
											)
										: Effect.sleep(3000)
								).pipe(
									Effect.zipRight(
										Deferred.fail(result, new HardwareReplyTimeout()),
									),
									Effect.interruptible,
									Effect.ensuring(
										Deferred.fail(result, new HardwareUnavailable()),
									),
									Effect.forkIn(scope),
								);
								const reply = yield* Deferred.await(result).pipe(
									Effect.ensuring(Fiber.interrupt(timeout)),
								);
								if (reply._tag === "Ack" && reply.status !== 0x90)
									return yield* new HardwareCommandRejected(reply.status);
								return reply;
							}).pipe(
								Effect.onExit((exit) =>
									Effect.sync(() => {
										pending = Option.none();
										if (
											Exit.isFailure(exit) &&
											!Option.exists(
												Cause.failureOption(exit.cause),
												(error) =>
													error._tag === "HardwareCommandRejected" ||
													(command._tag === "Query" &&
														command.feature === "version" &&
														error._tag === "HardwareReplyTimeout"),
											)
										)
											poisoned = true;
									}),
								),
							);
						}),
					);
				const send = Effect.fn("HardwareControls.send")(
					(command: HardwareCommand): Effect.Effect<void, HardwareError> =>
						(command._tag === "Dfu"
							? Effect.fail(new HardwareCommandRejected())
							: exchange(command)
						).pipe(
							Effect.tapError((error) =>
								Effect.sync(() => {
									errorCode = error.code;
								}),
							),
							Effect.asVoid,
						),
				);
				const releaseKeyboard = (
					command: Extract<HardwareCommand, { _tag: "Keyboard" }> & {
						action: 0;
					},
				): Effect.Effect<void, HardwareError> =>
					Effect.suspend(() => (poisoned ? rawWrite(command) : send(command)));
				const holdChord = Effect.fn("HardwareControls.holdChord")(function* (
					chord: string,
				): Effect.fn.Return<Effect.Effect<void, HardwareError>, HardwareError> {
					const key = encodeDeviceChord(chord);
					if (Either.isLeft(key))
						return yield* new HardwareUnavailable(key.left);
					const release = releaseKeyboard({
						_tag: "Keyboard",
						action: 0,
						...key.right,
					});
					yield* send({ _tag: "Keyboard", action: 1, ...key.right }).pipe(
						Effect.onError(() =>
							release.pipe(
								Effect.catchAll((error) => Effect.logWarning(error)),
							),
						),
					);
					return release;
				});

				const silence = Effect.suspend(() =>
					poisoned
						? rawWrite({ _tag: "Buzzer", level: 0 })
						: send({ _tag: "Buzzer", level: 0 }),
				).pipe(Effect.ignore);
				const playSequence = Effect.fn("HardwareControls.playSequence")(
					(input: unknown): Effect.Effect<void, HardwareError> =>
						Effect.gen(function* () {
							const decoded = Schema.decodeUnknownEither(ToneSequence)(input);
							if (Either.isLeft(decoded))
								return yield* new HardwareCommandRejected();
							yield* toneLock.withPermits(1)(
								Effect.gen(function* () {
									yield* ensureActive();
									if (
										!preferences.buzzerEnabled ||
										preferences.alertVolume === 0
									)
										return;
									const volume = preferences.alertVolume;
									const playback = {
										stop: yield* Deferred.make<void>(),
										done: yield* Deferred.make<void>(),
									};
									sequenceStop = playback;
									let sounding = false;
									yield* Effect.gen(function* () {
										for (const [level, duration] of decoded.right) {
											if (
												!preferences.buzzerEnabled ||
												preferences.alertVolume === 0
											)
												break;
											sounding = level !== 0;
											yield* send({
												_tag: "Buzzer",
												level: level === 0 ? 0 : volume,
											}).pipe(Effect.uninterruptible);
											yield* Effect.sleep(duration);
											yield* send({ _tag: "Buzzer", level: 0 }).pipe(
												Effect.uninterruptible,
											);
											sounding = false;
											yield* Effect.sleep(10);
										}
									}).pipe(
										Effect.raceFirst(Deferred.await(playback.stop)),
										Effect.onExit((exit) =>
											Effect.gen(function* () {
												if (
													sounding &&
													(Exit.isFailure(exit) ||
														(yield* Deferred.isDone(playback.stop)))
												)
													yield* silence;
												yield* Deferred.succeed(playback.done, undefined);
												if (sequenceStop === playback) sequenceStop = undefined;
											}),
										),
									);
								}),
							);
						}),
				);
				const playTone = Effect.fn("HardwareControls.playTone")(
					(name: ToneName): Effect.Effect<void, HardwareError> =>
						playSequence(buzzerTones[name]),
				);
				const interruptLongTone = Effect.gen(function* () {
					if (Option.isSome(longTone)) {
						yield* Fiber.interrupt(longTone.value);
						longTone = Option.none();
					}
				});
				const stopLongTone = toneTransitionLock.withPermits(1)(
					interruptLongTone.pipe(Effect.uninterruptible),
				);
				const setLongTone = Effect.fn("HardwareControls.setLongTone")(
					(on: boolean): Effect.Effect<void, HardwareError> =>
						Effect.suspend(() => {
							let worker: Fiber.RuntimeFiber<void, never> | undefined;
							return Effect.gen(function* () {
								const started = yield* toneTransitionLock.withPermits(1)(
									Effect.gen(function* () {
										yield* ensureActive();
										yield* interruptLongTone;
										// Preferences or lifecycle may change while trailing silence drains.
										yield* ensureActive();
										if (toneClosing) return yield* new HardwareUnavailable();
										if (
											!on ||
											!preferences.buzzerEnabled ||
											preferences.alertVolume === 0
										)
											return Option.none<
												Deferred.Deferred<void, HardwareError>
											>();
										const started = yield* Deferred.make<void, HardwareError>();
										worker = yield* toneLock
											.withPermits(1)(
												Effect.gen(function* () {
													yield* send({
														_tag: "Buzzer",
														level: preferences.alertVolume,
													}).pipe(Effect.uninterruptible);
													yield* Deferred.succeed(started, undefined);
													yield* Effect.never;
												}).pipe(Effect.ensuring(silence)),
											)
											.pipe(
												Effect.onExit((exit) =>
													Exit.isFailure(exit)
														? Deferred.fail(
																started,
																Option.getOrElse(
																	Cause.failureOption(exit.cause),
																	() => new HardwareUnavailable(),
																),
															)
														: Deferred.succeed(started, undefined),
												),
												Effect.ignore,
												Effect.interruptible,
												Effect.forkIn(scope),
											);
										longTone = Option.some(worker);
										return Option.some(started);
									}).pipe(Effect.uninterruptible),
								);
								// A pending playback lock must not block a subsequent release request.
								if (Option.isSome(started))
									yield* Deferred.await(started.value);
							}).pipe(
								// Install cleanup around the entire transition, including the
								// boundary between publishing the worker and awaiting startup.
								Effect.onInterrupt(() =>
									toneTransitionLock.withPermits(1)(
										Effect.suspend(() =>
											Option.isSome(longTone) && longTone.value === worker
												? interruptLongTone
												: Effect.void,
										),
									),
								),
							);
						}),
				);
				const flush = Effect.fn("HardwareControls.flush")(
					(): Effect.Effect<void, HardwarePreferencesFailed> =>
						preferenceLock.withPermits(1)(
							Effect.gen(function* () {
								if (!owner.dirty || owners.get(identity.serial) !== owner)
									return;
								const savingPreferences = owner.preferences;
								yield* store.write(identity.serial, savingPreferences);
								if (preferences === savingPreferences) owner.dirty = false;
								backgroundError = Option.none();
							}).pipe(Effect.uninterruptible),
						),
				);
				const saveSoon = Effect.fn("HardwareControls.saveSoon")(function* () {
					owner.preferences = preferences;
					owner.dirty = true;
					if (Option.isSome(saving)) yield* Fiber.interrupt(saving.value);
					saving = Option.some(
						yield* Effect.sleep(500).pipe(
							Effect.zipRight(flush()),
							Effect.catchTag("HardwarePreferencesFailed", (error) =>
								Effect.sync(() => {
									backgroundError = Option.some(error);
								}),
							),
							Effect.forkIn(scope),
						),
					);
				});
				const rememberLive = Effect.fn("HardwareControls.rememberLive")(
					function* () {
						preferences = {
							...preferences,
							...(mic === undefined ? {} : { mic }),
							...(luminance === undefined ? {} : { luminance }),
						};
						yield* saveSoon();
					},
				);
				yield* Effect.addFinalizer(() =>
					Effect.gen(function* () {
						if (Option.isSome(preview)) yield* Fiber.interrupt(preview.value);
						toneClosing = true;
						yield* stopLongTone;
						if (Option.isSome(saving)) yield* Fiber.interrupt(saving.value);
						yield* flush().pipe(
							Effect.catchTag("HardwarePreferencesFailed", (error) =>
								Effect.logError(error.code),
							),
						);
						active = false;
					}),
				);
				return {
					qmk: Effect.fn("HardwareControls.qmk")(function* (commands) {
						const operations = yield* importQmkOperations(commands);
						return yield* wireLock.withPermits(1)(
							Effect.gen(function* () {
								yield* ensureActive();
								const exchangeRaw = connection.exchangeRaw;
								if (!exchangeRaw) return yield* new HardwareUnavailable();
								const exchange = (
									operation: Exclude<
										import("./qmk-operations.js").QmkOperation,
										{ _tag: "probe" }
									>,
								) =>
									Effect.gen(function* () {
										yield* ensureActive();
										const { report, prefix, length } =
											qmkOperationBytes(operation);
										const reply = yield* exchangeRaw(report, (bytes) => {
											const body =
												bytes.length === 33 && bytes[0] === 0
													? bytes.slice(1)
													: bytes;
											return (
												body.length >= prefix.length + length &&
												prefix.every((v, i) => body[i] === v)
											);
										}).pipe(
											Effect.mapError(
												(cause) => new HardwareUnavailable(cause),
											),
										);
										yield* ensureActive();
										const body =
											reply.length === 33 && reply[0] === 0
												? reply.slice(1)
												: reply;
										return Array.from(
											body.slice(prefix.length, prefix.length + length),
										);
									});
								return yield* Effect.forEach(operations, (operation) =>
									Effect.gen(function* () {
										if (operation._tag !== "probe")
											return yield* exchange(operation);
										const get = {
											_tag: "get" as const,
											prefix: operation.prefix,
											length: operation.values.length,
										};
										const before = yield* exchange(get);
										// The whole reversible probe stays on this owner and transaction lock.
										// Once a test write starts, cancellation must still restore its old value.
										const after = yield* Effect.gen(function* () {
											const attempted = yield* exchange({
												_tag: "set",
												prefix: operation.prefix,
												values: operation.values,
											}).pipe(Effect.zipRight(exchange(get)), Effect.either);
											yield* exchange({
												_tag: "set",
												prefix: operation.prefix,
												values: before,
											});
											return yield* attempted;
										}).pipe(Effect.uninterruptible);
										const changed = before.some(
											(value, i) => value !== after[i],
										);
										return [...before, ...after, changed ? 1 : 0];
									}),
								);
							}).pipe(
								Effect.tapError(() =>
									Effect.sync(() => {
										poisoned = true;
									}),
								),
							),
						);
					}),
					readVersion: Effect.fn("HardwareControls.readVersion")(
						(): Effect.Effect<string, HardwareError> =>
							mutationLock.withPermits(1)(
								Effect.gen(function* () {
									const reply = yield* exchange({
										_tag: "Query",
										feature: "version",
									});
									if (reply._tag !== "FirmwareVersion")
										return yield* new HardwareUnavailable();
									firmware = {
										deviceName: reply.deviceName,
										major: reply.major,
										minor: reply.minor,
										patch: reply.patch,
									};
									return `${reply.major}.${reply.minor}.${reply.patch}`;
								}),
							),
					),
					enterDfu: Effect.fn("HardwareControls.enterDfu")(
						(): Effect.Effect<void, HardwareError> =>
							mutationLock.withPermits(1)(
								Effect.gen(function* () {
									yield* ensureActive();
									if (Option.isSome(preview))
										yield* Fiber.interrupt(preview.value);
									if (Option.isSome(saving))
										yield* Fiber.interrupt(saving.value);
									yield* flush();
									yield* wireLock.withPermits(1)(
										Effect.gen(function* () {
											yield* ensureActive();
											firmwareLocked = true;
											// DFU drops the connection; it has no hardware ack exchange.
											yield* rawWrite({ _tag: "Dfu" });
										}),
									);
								}),
							),
					),
					snapshot: Effect.fn("HardwareControls.snapshot")(
						function* (): Effect.fn.Return<HardwareSnapshot> {
							return {
								...identity,
								available:
									active &&
									owners.get(identity.serial) === owner &&
									!poisoned &&
									!firmwareLocked,
								preferenceStatus: Option.isSome(backgroundError)
									? "failed"
									: owner.dirty
										? "pending"
										: "saved",
								...(errorCode ? { errorCode } : {}),
								preferences,
								inputMode: yield* Ref.get(inputMode),
								recovered: {
									mic: preferences.mic ?? true,
									luminance: preferences.luminance ?? 255,
								},
								pendingStateSync,
								stateSyncSuccess,
								...(mic === undefined ? {} : { mic }),
								...(luminance === undefined ? {} : { luminance }),
								...(firmware ? { firmware } : {}),
							};
						},
					),
					refresh: Effect.fn("HardwareControls.refresh")(
						(): Effect.Effect<void, HardwareError> =>
							mutationLock.withPermits(1)(
								Effect.gen(function* () {
									pendingStateSync = true;
									stateSyncSuccess = false;
									for (const feature of [
										"version",
										"mic",
										"luminance",
									] as const) {
										const reply = yield* exchange({
											_tag: "Query",
											feature,
										}).pipe(
											Effect.catchTag("HardwareReplyTimeout", (error) => {
												if (feature !== "version") return Effect.fail(error);
												firmware = undefined;
												return Effect.succeed(undefined);
											}),
										);
										if (!reply) continue;
										if (reply._tag === "MicState") mic = reply.on;
										if (reply._tag === "LuminanceState")
											luminance = reply.value;
										if (reply._tag === "FirmwareVersion")
											firmware = {
												deviceName: reply.deviceName,
												major: reply.major,
												minor: reply.minor,
												patch: reply.patch,
											};
									}
									stateSyncSuccess = true;
									yield* rememberLive();
								}).pipe(
									Effect.ensuring(
										Effect.sync(() => {
											pendingStateSync = false;
										}),
									),
								),
							),
					),
					toggleMic: Effect.fn("HardwareControls.toggleMic")(
						(): Effect.Effect<void, HardwareError> =>
							mutationLock.withPermits(1)(
								Effect.gen(function* () {
									if (mic === undefined)
										return yield* new HardwareUnavailable();
									const next = !mic;
									yield* send({ _tag: "Mic", on: next });
									mic = next;
									yield* rememberLive();
								}),
							),
					),
					stepBrightness: Effect.fn("HardwareControls.stepBrightness")(
						(direction: -1 | 1): Effect.Effect<void, HardwareError> =>
							mutationLock.withPermits(1)(
								Effect.gen(function* () {
									yield* ensureActive();
									if (luminance === undefined)
										return yield* new HardwareUnavailable();
									const next = stepLuminance(luminance, direction);
									if (next !== luminance)
										yield* send({ _tag: "Luminance", value: next });
									luminance = next;
									yield* rememberLive();
								}),
							),
					),
					configure: Effect.fn("HardwareControls.configure")(
						(input: unknown): Effect.Effect<void, HardwareError> =>
							mutationLock.withPermits(1)(
								Effect.gen(function* () {
									yield* ensureActive();
									const decoded =
										Schema.decodeUnknownEither(HardwarePreferences)(input);
									if (Either.isLeft(decoded))
										return yield* new HardwareUnavailable(decoded.left);
									const volumeChanged =
										preferences.alertVolume !== decoded.right.alertVolume;
									preferences = {
										...decoded.right,
										...(preferences.mic === undefined
											? {}
											: { mic: preferences.mic }),
										...(preferences.luminance === undefined
											? {}
											: { luminance: preferences.luminance }),
									};
									if (
										!preferences.buzzerEnabled ||
										preferences.alertVolume === 0
									) {
										const playback = sequenceStop;
										if (playback) {
											yield* Deferred.succeed(playback.stop, undefined);
											yield* Deferred.await(playback.done);
										}
										yield* stopLongTone;
									}
									owner.preferences = preferences;
									owner.dirty = true;
									if (Option.isSome(preview))
										yield* Fiber.interrupt(preview.value);
									if (Option.isSome(saving))
										yield* Fiber.interrupt(saving.value);
									if (volumeChanged)
										preview = Option.some(
											yield* Effect.sleep(300).pipe(
												Effect.zipRight(playTone("preview")),
												Effect.catchTags({
													HardwareUnavailable: (error) =>
														Effect.sync(() => {
															errorCode = error.code;
														}),
													HardwareReplyTimeout: (error) =>
														Effect.sync(() => {
															errorCode = error.code;
														}),
													HardwareCommandRejected: (error) =>
														Effect.sync(() => {
															errorCode = error.code;
														}),
													HardwarePreferencesFailed: (error) =>
														Effect.sync(() => {
															errorCode = error.code;
														}),
												}),
												Effect.forkIn(scope),
											),
										);
									yield* saveSoon();
									if (Option.isSome(backgroundError))
										return yield* backgroundError.value;
								}),
							),
					),
					setInputMode: Effect.fn("HardwareControls.setInputMode")(function* (
						input: unknown,
					): Effect.fn.Return<void, HardwareError> {
						yield* ensureActive();
						const mode = Schema.decodeUnknownEither(InputMode)(input);
						if (Either.isLeft(mode))
							return yield* new HardwareUnavailable(mode.left);
						yield* Ref.set(inputMode, mode.right);
					}),
					setLocked: Effect.fn("HardwareControls.setLocked")(
						(locked: boolean): Effect.Effect<void, HardwareError> =>
							mutationLock.withPermits(1)(
								Effect.gen(function* () {
									yield* ensureActive();
									if (locked) {
										if (lockCycle) return;
										lockCycle = true;
										if (preferences.knobLedAlwaysOn) return;
										const reply = yield* exchange({
											_tag: "Query",
											feature: "knobLed",
										});
										if (reply._tag !== "KnobLedState")
											return yield* new HardwareUnavailable();
										if (!reply.on) return;
										yield* send({ _tag: "KnobLed", on: false });
										restoreKnobLed = true;
									} else {
										if (restoreKnobLed)
											yield* send({ _tag: "KnobLed", on: true });
										restoreKnobLed = false;
										lockCycle = false;
									}
								}).pipe(Effect.uninterruptible),
							),
					),
					send,
					holdChord: (chord: string) =>
						holdChord(chord).pipe(
							Effect.map((release) =>
								release.pipe(mutationLock.withPermits(1)),
							),
							mutationLock.withPermits(1),
						),
					pressChord: Effect.fn("HardwareControls.pressChord")(
						(chord: string): Effect.Effect<void, HardwareError> =>
							mutationLock.withPermits(1)(
								Effect.gen(function* () {
									const key = encodeDeviceChord(chord);
									if (Either.isLeft(key))
										return yield* new HardwareUnavailable(key.left);
									let releaseError: Option.Option<HardwareError> =
										Option.none();
									const releaseCommand: Extract<
										HardwareCommand,
										{ _tag: "Keyboard" }
									> & { action: 0 } = {
										_tag: "Keyboard",
										action: 0,
										...key.right,
									};
									yield* Effect.acquireUseRelease(
										Effect.void,
										() =>
											send({ _tag: "Keyboard", action: 1, ...key.right }).pipe(
												Effect.zipRight(Effect.sleep(50)),
											),
										() =>
											releaseKeyboard(releaseCommand).pipe(
												Effect.matchEffect({
													onSuccess: () => Effect.void,
													onFailure: (error) =>
														Effect.sync(() => {
															releaseError = Option.some(error);
														}),
												}),
											),
									);
									if (Option.isSome(releaseError))
										return yield* releaseError.value;
								}),
							),
					),
					playSequence,
					setLongTone,
					playTone,
				};
			});
			return { create };
		}),
	},
) {}
