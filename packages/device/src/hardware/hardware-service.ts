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
			const create = Effect.fn("HardwareControls.create")(function* (
				connection: QuakeConnection,
				identity: { readonly serial: string; readonly session: string },
			): Effect.fn.Return<
				{
					readonly snapshot: () => Effect.Effect<HardwareSnapshot>;
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
					readonly pressChord: (
						chord: string,
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
				const initial = yield* store.read(identity.serial);
				let preferences = Option.getOrElse(
					initial,
					() => defaultHardwarePreferences,
				);
				let mic: boolean | undefined;
				let luminance: number | undefined;
				let firmware: HardwareSnapshot["firmware"];
				let active = true;
				let firmwareLocked = false;
				let lockCycle = false;
				let restoreKnobLed = false;
				let poisoned = false;
				let dirty = false;
				let errorCode: string | undefined;
				let backgroundError: Option.Option<HardwarePreferencesFailed> =
					Option.none();
				let pending: Option.Option<{
					readonly matches: (reply: HardwareReply) => boolean;
					readonly result: Deferred.Deferred<HardwareReply, HardwareError>;
				}> = Option.none();
				const wireLock = yield* Effect.makeSemaphore(1);
				const mutationLock = yield* Effect.makeSemaphore(1);
				const toneLock = yield* Effect.makeSemaphore(1);
				let preview: Option.Option<Fiber.RuntimeFiber<void, never>> =
					Option.none();
				let saving: Option.Option<Fiber.RuntimeFiber<void, never>> =
					Option.none();
				const ensureActive = (): Effect.Effect<void, HardwareUnavailable> =>
					active && !poisoned && !firmwareLocked
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
								const timeout = yield* Effect.sleep(3000).pipe(
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
												(error) => error._tag === "HardwareCommandRejected",
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
				const silence = Effect.suspend(() =>
					poisoned
						? rawWrite({ _tag: "Buzzer", level: 0 })
						: send({ _tag: "Buzzer", level: 0 }),
				).pipe(Effect.ignore);
				const playTone = Effect.fn("HardwareControls.playTone")(
					(name: ToneName): Effect.Effect<void, HardwareError> =>
						toneLock
							.withPermits(1)(
								Effect.gen(function* () {
									yield* ensureActive();
									if (
										!preferences.buzzerEnabled ||
										preferences.alertVolume === 0
									)
										return;
									const volume = preferences.alertVolume;
									for (const [level, duration] of buzzerTones[name]) {
										yield* send({
											_tag: "Buzzer",
											level: level === 0 ? 0 : volume,
										}).pipe(Effect.uninterruptible);
										yield* Effect.sleep(duration);
										yield* send({ _tag: "Buzzer", level: 0 }).pipe(
											Effect.uninterruptible,
										);
										yield* Effect.sleep(10);
									}
								}),
							)
							.pipe(
								Effect.onExit((exit) =>
									Exit.isFailure(exit) ? silence : Effect.void,
								),
							),
				);
				const flush = Effect.fn("HardwareControls.flush")(
					(): Effect.Effect<void, HardwarePreferencesFailed> =>
						preferenceLock.withPermits(1)(
							Effect.gen(function* () {
								if (!dirty) return;
								const savingPreferences = preferences;
								yield* store.write(identity.serial, savingPreferences);
								if (preferences === savingPreferences) dirty = false;
								backgroundError = Option.none();
							}).pipe(Effect.uninterruptible),
						),
				);
				yield* Effect.addFinalizer(() =>
					Effect.gen(function* () {
						if (Option.isSome(preview)) yield* Fiber.interrupt(preview.value);
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
								available: active && !poisoned && !firmwareLocked,
								preferenceStatus: Option.isSome(backgroundError)
									? "failed"
									: dirty
										? "pending"
										: "saved",
								...(errorCode ? { errorCode } : {}),
								preferences,
								inputMode: yield* Ref.get(inputMode),
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
									for (const feature of [
										"version",
										"mic",
										"luminance",
									] as const) {
										const reply = yield* exchange({ _tag: "Query", feature });
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
								}),
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
									preferences = decoded.right;
									dirty = true;
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
					pressChord: Effect.fn("HardwareControls.pressChord")(
						(chord: string): Effect.Effect<void, HardwareError> =>
							mutationLock.withPermits(1)(
								Effect.gen(function* () {
									const key = encodeDeviceChord(chord);
									if (Either.isLeft(key))
										return yield* new HardwareUnavailable(key.left);
									let releaseError: Option.Option<HardwareError> =
										Option.none();
									const releaseCommand: HardwareCommand = {
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
											Effect.suspend(() =>
												poisoned
													? rawWrite(releaseCommand)
													: send(releaseCommand),
											).pipe(
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
					playTone,
				};
			});
			return { create };
		}),
	},
) {}
