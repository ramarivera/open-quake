import {
	Clock,
	Effect,
	Fiber,
	Option,
	Schema,
	Scope,
	Stream,
	SubscriptionRef,
} from "effect";
import {
	InvalidKnobConfig,
	type KnobError,
	KnobSessionStale,
} from "../knob-errors.js";
import {
	KNOB_TIMING,
	KnobModelContext,
	KnobModelInput,
	type KnobModelSnapshot,
	type VolumeReading,
} from "./contracts.js";
import {
	canFocus,
	readyProfiles,
	selectorProfiles,
	volumeStep,
	wrapIndex,
} from "./invariants.js";
import { KnobModelPorts, NoKnobModelPorts } from "./ports.js";

const closed: KnobModelSnapshot["selector"] = {
	mode: "closed",
	index: 0,
	page: 0,
	progress: 0,
	ringVisible: false,
	direction: 1,
};
const initial: KnobModelSnapshot = {
	context: {
		session: {
			deviceId: "desktop-preview",
			sessionId: "unconfigured",
			profileId: "local-profile",
			revision: 0,
		},
		profiles: [
			{
				id: "local-profile",
				name: "My profile",
				colorful: false,
				thumbnail: { _tag: "missing" },
			},
		],
		keys: [],
		player: false,
	},
	revision: 0,
	selector: closed,
	focus: { _tag: "none" },
	volume: { phase: "inactive", level: 0, muted: false },
	notice: "",
};

export class KnobModel extends Effect.Service<KnobModel>()(
	"@open-quake/device/KnobModel",
	{
		accessors: true,
		dependencies: [NoKnobModelPorts],
		scoped: Effect.gen(function* () {
			const ports = yield* KnobModelPorts;
			const scope = yield* Scope.Scope;
			const mutex = yield* Effect.makeSemaphore(1);
			const updates = yield* SubscriptionRef.make(initial);
			let state = initial;
			let configured = false;
			let generation = 0;
			let hold = Option.none<number>();
			let voiceOwned = Option.none<number>();
			let connected = true;
			let warming = false;
			let contextGeneration = 0;
			let pendingVolume = Option.none<VolumeReading>();
			let volumeWriter = Option.none<Fiber.RuntimeFiber<void, never>>();
			let lastTurn = Number.NEGATIVE_INFINITY;
			let lastProbe = Number.NEGATIVE_INFINITY;
			const timers = new Map<string, Fiber.RuntimeFiber<void, never>>();
			const emit = (patch: Partial<KnobModelSnapshot>): Effect.Effect<void> =>
				Effect.suspend(() => {
					state = { ...state, ...patch, revision: state.revision + 1 };
					return SubscriptionRef.set(updates, state);
				});
			const stop = (name: string): Effect.Effect<void> =>
				Effect.gen(function* () {
					const fiber = timers.get(name);
					timers.delete(name);
					if (fiber) yield* Fiber.interrupt(fiber);
				});
			const stopSelection = Effect.gen(function* () {
				yield* stop("commit");
				yield* stop("hide");
			});
			const report = (error: KnobError): Effect.Effect<void> =>
				Effect.gen(function* () {
					if (error._tag === "KnobSessionStale") return;
					yield* emit({ notice: error.code });
					if (ports.alert)
						yield* ports.alert(error.code).pipe(
							Effect.matchEffect({
								onFailure: (failure) => Effect.logWarning(failure.code),
								onSuccess: () => Effect.void,
							}),
							Effect.forkIn(scope),
						);
				});
			const quiet = (
				effect: Effect.Effect<void, KnobError>,
			): Effect.Effect<void> =>
				effect.pipe(
					Effect.matchEffect({
						onFailure: report,
						onSuccess: () => Effect.void,
					}),
				);
			const schedule = (
				name: string,
				delay: number,
				effect: Effect.Effect<void, KnobError>,
			): Effect.Effect<void> =>
				Effect.gen(function* () {
					yield* stop(name);
					const fiber = yield* Effect.sleep(delay).pipe(
						Effect.zipRight(
							mutex.withPermits(1)(
								Effect.gen(function* () {
									timers.delete(name);
									yield* quiet(effect);
								}),
							),
						),
						Effect.forkIn(scope),
					);
					timers.set(name, fiber);
				});
			const stopVolume = Effect.gen(function* () {
				pendingVolume = Option.none();
				const writer = volumeWriter;
				volumeWriter = Option.none();
				if (Option.isSome(writer)) yield* Fiber.interrupt(writer.value);
			});
			const writeVolume = (reading: VolumeReading): Effect.Effect<void> =>
				Effect.gen(function* () {
					pendingVolume = Option.some(reading);
					if (Option.isSome(volumeWriter)) return;
					const write = Effect.gen(function* () {
						while (Option.isSome(pendingVolume)) {
							const next = pendingVolume.value;
							pendingVolume = Option.none();
							yield* ports.writeVolume(next).pipe(
								Effect.matchEffect({
									onFailure: (error) =>
										mutex.withPermits(1)(
											Effect.gen(function* () {
												pendingVolume = Option.none();
												yield* emit({
													volume: { ...state.volume, phase: "unavailable" },
												});
												yield* report(error);
											}),
										),
									onSuccess: () => Effect.void,
								}),
							);
						}
					}).pipe(
						Effect.ensuring(
							Effect.sync(() => {
								volumeWriter = Option.none();
							}),
						),
					);
					volumeWriter = Option.some(yield* Effect.forkIn(write, scope));
				});
			const cancelVoice = Effect.gen(function* () {
				const owned = voiceOwned;
				hold = Option.none();
				voiceOwned = Option.none();
				if (Option.isSome(owned))
					yield* ports.voice({
						action: "cancel",
						session: state.context.session,
						generation: owned.value,
					});
			});
			const replace = (
				context: KnobModelContext,
				preserveVoice = false,
			): Effect.Effect<void, KnobError> =>
				Effect.gen(function* () {
					contextGeneration++;
					configured = true;
					yield* stopSelection;
					yield* stopVolume;
					// Route edits are future-capture changes. Keep a held generation alive
					// while its committed profile still owns this device.
					if (
						!preserveVoice ||
						!connected ||
						context.session.deviceId !== state.context.session.deviceId ||
						context.session.profileId !== state.context.session.profileId
					)
						yield* cancelVoice;
					connected = true;
					lastTurn = Number.NEGATIVE_INFINITY;
					yield* emit({
						context,
						selector: closed,
						focus: { _tag: "none" },
						volume: { ...state.volume, phase: "inactive" },
						notice: "",
					});
				});
			const commit = (
				profileId: string,
				keepRing = false,
			): Effect.Effect<void, KnobError> =>
				Effect.gen(function* () {
					const ring = state.selector;
					const switched = profileId !== state.context.session.profileId;
					yield* stopSelection;
					yield* emit({
						selector: {
							...closed,
							...(keepRing ? { ...ring, mode: "ring" as const } : {}),
						},
					});
					if (switched) {
						// Persistence owns truth; failed writes must not reset the old voice/volume session.
						const previousProfiles = state.context.profiles;
						const context = yield* ports
							.selectProfile(profileId)
							.pipe(Effect.onError(() => emit({ selector: closed })));
						yield* stopVolume;
						yield* quiet(cancelVoice);
						yield* emit({
							context: {
								...context,
								profiles: context.profiles.map((profile) => {
									const previous = previousProfiles.find(
										(candidate) => candidate.id === profile.id,
									);
									return {
										...profile,
										thumbnail:
											profile.thumbnail._tag === "missing" &&
											profile.thumbnailKey !== undefined &&
											profile.thumbnailKey === previous?.thumbnailKey
												? previous.thumbnail
												: profile.thumbnail,
									};
								}),
							},
							focus: { _tag: "none" },
							volume: { ...state.volume, phase: "inactive" },
						});
					}
					if (keepRing)
						yield* schedule(
							"hide",
							switched
								? KNOB_TIMING.pickerRingHide
								: KNOB_TIMING.ringHide - KNOB_TIMING.ringCommit,
							emit({ selector: closed }),
						);
				});
			const confirm = (keepRing = false): Effect.Effect<void, KnobError> =>
				Effect.suspend(() => {
					const target = selectorProfiles(state)[state.selector.index];
					return target ? commit(target.id, keepRing) : Effect.void;
				});
			const arm = (picker: boolean): Effect.Effect<void> =>
				Effect.gen(function* () {
					const duration = picker
						? KNOB_TIMING.pickerCommit
						: KNOB_TIMING.ringCommit;
					// Progress is domain-owned as well; hidden renderer windows cannot delay commit.
					const started = yield* Clock.currentTimeMillis;
					const progress: Effect.Effect<void, KnobError> = Effect.gen(
						function* () {
							const elapsed = (yield* Clock.currentTimeMillis) - started;
							if (elapsed >= duration) yield* confirm(!picker);
							else {
								yield* emit({
									selector: {
										...state.selector,
										progress: Math.min(1, elapsed / duration),
									},
								});
								yield* schedule(
									"commit",
									Math.min(KNOB_TIMING.progress, duration - elapsed),
									progress,
								);
							}
						},
					);
					yield* schedule(
						"commit",
						Math.min(KNOB_TIMING.progress, duration),
						progress,
					);
					yield* schedule(
						"hide",
						picker ? KNOB_TIMING.pickerRingHide : KNOB_TIMING.ringHide,
						Effect.suspend(() =>
							emit({
								selector: {
									...state.selector,
									ringVisible: false,
									...(state.selector.mode === "ring"
										? { mode: "closed" as const }
										: {}),
								},
							}),
						),
					);
				});
			const warm = Effect.gen(function* () {
				if (warming) return;
				warming = true;
				const generation = contextGeneration;
				const profiles = state.context.profiles;
				yield* ports.warmThumbnails(profiles).pipe(
					Effect.flatMap((ready) =>
						mutex.withPermits(1)(
							Effect.gen(function* () {
								// Never open/replay the cold detent or change an already-open selector's entries.
								if (
									contextGeneration === generation &&
									state.selector.mode !== "picker"
								)
									yield* emit({
										context: {
											...state.context,
											profiles: state.context.profiles.map((profile) => {
												const candidate = ready.find(
													(value) => value.id === profile.id,
												);
												return {
													...profile,
													thumbnail:
														candidate?.thumbnailKey === profile.thumbnailKey
															? (candidate?.thumbnail ?? profile.thumbnail)
															: profile.thumbnail,
												};
											}),
										},
									});
							}),
						),
					),
					(effect) => quiet(effect),
					Effect.ensuring(
						Effect.sync(() => {
							warming = false;
						}),
					),
					Effect.forkIn(scope),
				);
			});
			const rotate = (delta: -1 | 1): Effect.Effect<void, KnobError> =>
				Effect.gen(function* () {
					if (state.focus._tag === "tile") {
						const keyCode = state.focus.keyCode;
						const angle = state.focus.angle;
						const key = state.context.keys.find(
							(key) => key.keyCode === keyCode && canFocus(key),
						);
						if (key) {
							yield* ports.focusedTurn(key, delta, state.context);
							yield* emit({
								focus: {
									...state.focus,
									_tag: "tile",
									keyCode,
									angle: angle + delta * 12,
								},
							});
							return;
						}
					}
					if (state.volume.phase === "active") {
						const now = yield* Clock.currentTimeMillis;
						if (now - lastProbe >= KNOB_TIMING.volumeProbe) {
							const result = yield* Effect.either(ports.readVolume);
							lastProbe = now;
							if (result._tag === "Left") {
								yield* emit({
									volume: { ...state.volume, phase: "unavailable" },
								});
								yield* report(result.left);
							} else if (now - lastTurn >= KNOB_TIMING.volumeGuard)
								yield* emit({ volume: { ...result.right, phase: "active" } });
						}
						if (state.volume.phase === "active") {
							const level = volumeStep(state.volume.level, delta);
							yield* writeVolume({ level, muted: level === 0 });
							lastTurn = now;
							yield* emit({
								volume: { phase: "active", level, muted: level === 0 },
							});
							return;
						}
					}
					const picker =
						state.selector.mode === "picker" ||
						readyProfiles(state.context.profiles).length > 0;
					const entries = picker
						? readyProfiles(state.context.profiles)
						: state.context.profiles;
					if (!entries.length) return;
					const base =
						state.selector.mode === (picker ? "picker" : "ring")
							? state.selector.index
							: entries.findIndex(
									(p) => p.id === state.context.session.profileId,
								);
					const index = wrapIndex(
						base < 0 ? (delta > 0 ? -1 : 0) + delta : base + delta,
						entries.length,
					);
					yield* emit({
						selector: {
							mode: picker ? "picker" : "ring",
							index,
							page: Math.floor(index / 15),
							progress: 0,
							ringVisible: !picker,
							direction: delta,
						},
						notice: "",
					});
					yield* arm(picker);
					if (!picker) yield* warm;
				});
			let focusGeneration = 0;
			const handle = (event: KnobModelInput): Effect.Effect<void, KnobError> =>
				Effect.gen(function* () {
					if (event.sessionId !== state.context.session.sessionId || !connected)
						return yield* KnobSessionStale.fromCause();
					switch (event._tag) {
						case "Rotate":
							return yield* rotate(event.delta);
						case "TapTile": {
							focusGeneration++;
							const key = state.context.keys.find(
								(k) => k.keyCode === event.keyCode,
							);
							const toggleOff =
								state.focus._tag === "tile" &&
								state.focus.keyCode === event.keyCode;
							yield* stopSelection;
							return yield* emit({
								selector: closed,
								focus:
									key && canFocus(key) && !toggleOff
										? {
												_tag: "tile",
												keyCode: key.keyCode,
												angle: 0,
												generation: focusGeneration,
											}
										: { _tag: "none" },
							});
						}
						case "RestoreFocus":
							if (
								state.focus._tag === "tile" &&
								state.focus.keyCode === event.keyCode &&
								state.focus.generation === event.generation
							)
								yield* emit({ focus: { _tag: "none" } });
							return;
						case "ToggleVolume": {
							if (!state.context.player) return;
							if (state.volume.phase === "active")
								return yield* emit({
									volume: { ...state.volume, phase: "inactive" },
								});
							yield* emit({ volume: { ...state.volume, phase: "activating" } });
							const reading = yield* Effect.either(ports.readVolume);
							if (reading._tag === "Left") {
								yield* emit({
									volume: { ...state.volume, phase: "unavailable" },
								});
								return yield* report(reading.left);
							}
							lastProbe = yield* Clock.currentTimeMillis;
							yield* stopSelection;
							return yield* emit({
								selector: closed,
								volume: { ...reading.right, phase: "active" },
							});
						}
						case "ObservedVolume":
							if (
								(yield* Clock.currentTimeMillis) - lastTurn >=
								KNOB_TIMING.volumeGuard
							)
								yield* emit({
									volume: {
										...state.volume,
										level: event.level,
										muted: event.muted,
									},
								});
							return;
						case "Page": {
							if (state.selector.mode !== "picker") return;
							const count = readyProfiles(state.context.profiles).length;
							const page = Math.max(
								0,
								Math.min(
									Math.ceil(count / 15) - 1,
									state.selector.page + event.delta,
								),
							);
							if (page === state.selector.page) return;
							yield* emit({
								selector: {
									...state.selector,
									index: page * 15,
									page,
									progress: 0,
									ringVisible: false,
								},
							});
							return yield* arm(true);
						}
						case "Select":
							if (
								state.selector.mode === "picker" &&
								readyProfiles(state.context.profiles).some(
									(p) => p.id === event.profileId,
								)
							)
								yield* commit(event.profileId);
							return;
						case "Dismiss":
							yield* stopSelection;
							return yield* emit({ selector: closed });
						case "Disconnect":
							connected = false;
							contextGeneration++;
							yield* stopVolume;
							yield* stopSelection;
							yield* emit({
								selector: closed,
								focus: { _tag: "none" },
								volume: { ...state.volume, phase: "inactive" },
							});
							return yield* cancelVoice;
						case "Key": {
							if (state.selector.mode === "picker" && event.code !== 255) {
								if (event.code === 1) return yield* confirm();
								yield* stopSelection;
								yield* emit({ selector: closed });
							}
							if (event.code === 2) {
								const colorful = state.context.profiles.find((p) => p.colorful);
								if (colorful) yield* commit(colorful.id);
								return;
							}
							if (event.code === 1) {
								if (state.focus._tag === "tile" && ports.focusedPress) {
									const focusedCode = state.focus.keyCode;
									const key = state.context.keys.find(
										(candidate) =>
											candidate.keyCode === focusedCode &&
											candidate.kind === "obsVolume" &&
											canFocus(candidate),
									);
									if (key) return yield* ports.focusedPress(key, state.context);
								}
								hold = Option.none();
								voiceOwned = Option.none();
								return yield* ports.voice({
									action: "interrupt",
									session: state.context.session,
									generation,
								});
							}
							if (event.code === 5) {
								if (Option.isSome(hold)) return;
								generation++;
								hold = Option.some(generation);
								voiceOwned = hold;
								return yield* ports
									.voice({
										action: "holdStart",
										session: state.context.session,
										generation,
									})
									.pipe(
										Effect.onError(() =>
											Effect.sync(() => {
												hold = Option.none();
												voiceOwned = Option.none();
											}),
										),
									);
							}
							const owned = hold;
							hold = Option.none();
							if (Option.isSome(owned))
								yield* ports.voice({
									action: "release",
									session: state.context.session,
									generation: owned.value,
								});
							return;
						}
					}
				});
			yield* Effect.addFinalizer(() => quiet(cancelVoice));
			return {
				configure: Effect.fn("KnobModel.configure")(
					(
						input: unknown,
						preserveVoice = false,
					): Effect.Effect<void, KnobError> =>
						Schema.decodeUnknown(KnobModelContext)(input).pipe(
							Effect.catchTag("ParseError", (cause) =>
								Effect.fail(InvalidKnobConfig.fromCause(cause)),
							),
							Effect.flatMap((context) =>
								mutex.withPermits(1)(replace(context, preserveVoice)),
							),
						),
				),
				synchronize: Effect.fn("KnobModel.synchronize")(
					(input: unknown): Effect.Effect<void, KnobError> =>
						Schema.decodeUnknown(KnobModelContext)(input).pipe(
							Effect.catchTag("ParseError", (cause) =>
								Effect.fail(InvalidKnobConfig.fromCause(cause)),
							),
							Effect.flatMap((context) =>
								mutex.withPermits(1)(
									Effect.suspend(() => {
										const identity = (value: KnobModelContext) =>
											JSON.stringify({
												deviceId: value.session.deviceId,
												profileId: value.session.profileId,
												revision: value.session.revision,
												pageId: value.pageId,
												keys: value.keys,
												player: value.player,
												profiles: value.profiles.map(
													({ id, name, colorful, thumbnailKey }) => ({
														id,
														name,
														colorful,
														thumbnailKey,
													}),
												),
											});
										if (identity(context) === identity(state.context))
											return Effect.void;
										return Effect.gen(function* () {
											const previous = state;
											const sameDevice =
												configured &&
												connected &&
												context.session.deviceId ===
													previous.context.session.deviceId;
											const switched =
												sameDevice &&
												context.session.profileId !==
													previous.context.session.profileId;
											const sameContent =
												sameDevice &&
												!switched &&
												context.session.revision ===
													previous.context.session.revision &&
												context.pageId === previous.context.pageId &&
												context.player === previous.context.player &&
												JSON.stringify(context.keys) ===
													JSON.stringify(previous.context.keys);
											const merged = {
												...context,
												profiles: context.profiles.map((profile) => {
													const cached = previous.context.profiles.find(
														(entry) => entry.id === profile.id,
													);
													return profile.thumbnail._tag === "missing" &&
														profile.thumbnailKey !== undefined &&
														profile.thumbnailKey === cached?.thumbnailKey
														? { ...profile, thumbnail: cached.thumbnail }
														: profile;
												}),
											};
											if (sameContent) {
												contextGeneration++;
												yield* emit({ context: merged });
											} else yield* replace(merged, true);
											if (switched) {
												const index = merged.profiles.findIndex(
													(profile) => profile.id === merged.session.profileId,
												);
												yield* emit({
													selector: {
														...closed,
														mode: "ring",
														ringVisible: true,
														index,
														page: Math.floor(index / 15),
													},
												});
												yield* schedule(
													"hide",
													KNOB_TIMING.pickerRingHide,
													emit({ selector: closed }),
												);
											} else if (
												sameDevice &&
												previous.selector.mode !== "closed"
											) {
												// Source reinitializes the open selector to the active ID after menu edits.
												const picker =
													previous.selector.mode === "picker" &&
													readyProfiles(merged.profiles).length > 0;
												const entries = picker
													? readyProfiles(merged.profiles)
													: merged.profiles;
												const index = Math.max(
													0,
													entries.findIndex(
														(profile) =>
															profile.id === merged.session.profileId,
													),
												);
												yield* emit({
													selector: {
														...previous.selector,
														mode: picker ? "picker" : "ring",
														ringVisible: !picker,
														index,
														page: Math.floor(index / 15),
														progress: 0,
													},
												});
												yield* arm(picker);
											}
										});
									}),
								),
							),
						),
				),
				dispatch: Effect.fn("KnobModel.dispatch")(
					(input: unknown): Effect.Effect<void, KnobError> =>
						Schema.decodeUnknown(KnobModelInput, { onExcessProperty: "error" })(
							input,
						).pipe(
							Effect.catchTag("ParseError", (cause) =>
								Effect.fail(InvalidKnobConfig.fromCause(cause)),
							),
							Effect.flatMap((event) =>
								mutex.withPermits(1)(
									handle(event).pipe(Effect.tapError(report)),
								),
							),
						),
				),
				snapshot: Effect.fn("KnobModel.snapshot")(
					(): Effect.Effect<KnobModelSnapshot> => Effect.sync(() => state),
				),
				snapshots: updates.changes.pipe(
					Stream.changesWith((a, b) => a.revision === b.revision),
				),
			};
		}),
	},
) {}
