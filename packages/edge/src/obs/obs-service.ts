import {
	Clock,
	Context,
	Effect,
	type Redacted,
	Schedule,
	Schema,
} from "effect";
import { ObsCommand } from "../../../device/src/actions/obs-contracts.js";
import { type ObsRequest, obsExecute } from "./obs-actions.js";
import {
	emptyObsSaved,
	ObsCatalog,
	type ObsConnection,
	ObsConnectionConfig,
	type ObsSaved,
	type ObsStatus,
	type ObsTile,
	ObsVisible,
} from "./obs-contracts.js";
import {
	ObsConfigurationRejected,
	type ObsError,
	ObsNetworkFailed,
	obsBoundaryError,
} from "./obs-errors.js";
import { ObsRepository } from "./obs-repository.js";
import { readObsTile, unavailableObsTile } from "./obs-tiles.js";
export class ObsPorts extends Context.Tag("obs/Ports")<
	ObsPorts,
	{
		readonly open: (
			config: ObsConnectionConfig,
			password: Redacted.Redacted<string>,
			signal: AbortSignal,
		) => Promise<ObsConnection>;
		readonly publish: (owner: string, tiles: readonly ObsTile[]) => void;
	}
>() {}
export class ObsService extends Effect.Service<ObsService>()("obs/Service", {
	accessors: true,
	dependencies: [ObsRepository.Default],
	scoped: Effect.gen(function* () {
		const repository = yield* ObsRepository;
		const ports = yield* ObsPorts;
		const lock = yield* Effect.makeSemaphore(1);
		let config: ObsSaved = emptyObsSaved;
		let connection: ObsConnection | undefined;
		let state: ObsStatus["state"] = "disconnected",
			code = "";
		let detection: ObsStatus["detection"] = "not-run",
			source = "";
		let lastError: ObsError | undefined;
		let blocked = false,
			manualDisconnect = false,
			started = false,
			nextRetry = 0,
			generation = 0;
		const visible = new Map<string, readonly ObsVisible[]>();
		const close = () => {
			connection?.close();
			connection = undefined;
		};
		const publicStatus = (): ObsStatus => ({
			host: config.host,
			port: config.port,
			autoConnect: config.autoConnect,
			state:
				state === "connected" && !connection?.connected()
					? "disconnected"
					: state,
			code,
			passwordSet: config.credentialRef !== "",
			manualOverride: config.manualOverride,
			detection,
			source,
		});
		const failure = (error: ObsError) =>
			Effect.gen(function* () {
				close();
				state = "failed";
				code = error.code;
				lastError = error;
				blocked = error._tag !== "ObsNetworkFailed";
				nextRetry = (yield* Clock.currentTimeMillis) + 5000;
			});
		const connectUnlocked = Effect.fn("ObsService.connectUnlocked")(
			function* (): Effect.fn.Return<ObsStatus, ObsError> {
				if (connection?.connected()) return publicStatus();
				close();
				config = yield* repository.read();
				state = "connecting";
				const password = yield* repository.password(config);
				connection = yield* Effect.tryPromise({
					try: (signal) => ports.open(config, password, signal),
					catch: obsBoundaryError,
				});
				state = "connected";
				code = "";
				blocked = false;
				return publicStatus();
			},
		);
		const connect = Effect.fn("ObsService.connect")(
			(): Effect.Effect<ObsStatus, ObsError> =>
				Effect.gen(function* () {
					manualDisconnect = false;
					blocked = false;
					started = true;
					return yield* connectUnlocked();
				}).pipe(Effect.tapError(failure), lock.withPermits(1)),
		);
		const status = Effect.fn("ObsService.status")(
			function* (): Effect.fn.Return<ObsStatus, ObsError> {
				config = yield* repository.read();
				return publicStatus();
			},
			lock.withPermits(1),
		);
		const configure = Effect.fn("ObsService.configure")(
			(
				input: unknown,
				password?: Redacted.Redacted<string>,
			): Effect.Effect<ObsStatus, ObsError> =>
				Effect.gen(function* () {
					const decoded = yield* Schema.decodeUnknown(ObsConnectionConfig)(
						input,
						{ onExcessProperty: "error" },
					).pipe(
						Effect.catchTag("ParseError", () =>
							Effect.fail(new ObsConfigurationRejected()),
						),
					);
					config = yield* repository.save(decoded, password);
					generation++;
					close();
					blocked = false;
					manualDisconnect = false;
					state = "disconnected";
					code = "";
					return publicStatus();
				}).pipe(lock.withPermits(1)),
		);
		const detect = Effect.fn("ObsService.detect")(
			(): Effect.Effect<ObsStatus, ObsError> =>
				Effect.gen(function* () {
					const result = yield* repository.detect();
					detection = result.found ? "found" : "not-found";
					source = result.source;
					config = yield* repository.read();
					if (!result.found) return publicStatus();
					generation++;
					close();
					state = "disconnected";
					code = "";
					blocked = false;
					return publicStatus();
				}).pipe(lock.withPermits(1)),
		);
		const disconnect = Effect.fn("ObsService.disconnect")(
			(): Effect.Effect<ObsStatus> =>
				Effect.sync(() => {
					manualDisconnect = true;
					generation++;
					close();
					state = "disconnected";
					code = "";
					return publicStatus();
				}).pipe(lock.withPermits(1)),
		);
		const request: ObsRequest = (type, data) =>
			Effect.suspend(() => {
				const active = connection;
				if (!active?.connected()) return Effect.fail(new ObsNetworkFailed());
				return Effect.tryPromise({
					try: (signal) => active.request(type, data, signal),
					catch: obsBoundaryError,
				});
			});
		const execute = Effect.fn("ObsService.execute")(
			(
				input: unknown,
				delta?: -1 | 1,
				beforeWrite?: () => Promise<void>,
			): Effect.Effect<void, ObsError> =>
				Effect.gen(function* () {
					const command = yield* Schema.decodeUnknown(ObsCommand)(input, {
						onExcessProperty: "error",
					}).pipe(
						Effect.catchTag("ParseError", () =>
							Effect.fail(new ObsConfigurationRejected()),
						),
					);
					if (command.type === "obsStats" || command.type === "obsScreenshot")
						return;
					if (blocked) return yield* lastError ?? new ObsNetworkFailed();
					if (manualDisconnect) return yield* new ObsNetworkFailed();
					yield* connectUnlocked();
					const guardedRequest: ObsRequest = (type, data) =>
						beforeWrite && !type.startsWith("Get")
							? Effect.tryPromise({
									try: beforeWrite,
									catch: (cause) => new ObsConfigurationRejected(cause),
								}).pipe(Effect.zipRight(request(type, data)))
							: request(type, data);
					yield* obsExecute(command, guardedRequest, delta);
				}).pipe(
					Effect.tapError((error) =>
						error._tag === "ObsRequestFailed" ||
						error._tag === "ObsConfigurationRejected"
							? Effect.void
							: failure(error),
					),
					lock.withPermits(1),
				),
		);
		const setVisible = Effect.fn("ObsService.setVisible")(
			(owner: string, input: unknown): Effect.Effect<void, ObsError> =>
				Effect.gen(function* () {
					const tiles = yield* Schema.decodeUnknown(
						Schema.Array(ObsVisible).pipe(Schema.maxItems(16)),
					)(input, { onExcessProperty: "error" }).pipe(
						Effect.catchTag("ParseError", () =>
							Effect.fail(new ObsConfigurationRejected()),
						),
					);
					if (tiles.length) visible.set(owner, tiles);
					else visible.delete(owner);
				}),
		);
		const release = Effect.fn("ObsService.release")(
			(owner: string): Effect.Effect<void> =>
				Effect.sync(() => {
					visible.delete(owner);
				}),
		);
		const poll = Effect.fn("ObsService.poll")(
			(): Effect.Effect<void> =>
				Effect.gen(function* () {
					if (!visible.size) return;
					const now = yield* Clock.currentTimeMillis;
					if (
						!manualDisconnect &&
						!blocked &&
						config.autoConnect &&
						!connection?.connected() &&
						now >= nextRetry
					)
						yield* Effect.suspend(() =>
							blocked || manualDisconnect
								? Effect.void
								: connectUnlocked().pipe(Effect.asVoid),
						).pipe(Effect.tapError(failure), Effect.ignore);
					const current = generation;
					for (const [owner, entries] of visible) {
						const tiles: ObsTile[] = [];
						for (const entry of entries) {
							const tile = connection?.connected()
								? yield* readObsTile(
										entry.id,
										entry.command,
										request,
										connection.transitioning(),
									).pipe(
										Effect.catchAll((error) => {
											if (error._tag === "ObsNetworkFailed")
												return failure(error).pipe(
													Effect.as(
														unavailableObsTile(entry.id, entry.command.type),
													),
												);
											return Effect.succeed(
												unavailableObsTile(entry.id, entry.command.type),
											);
										}),
									)
								: unavailableObsTile(entry.id, entry.command.type);
							tiles.push(tile);
						}
						if (generation === current && visible.get(owner) === entries)
							yield* Effect.sync(() => ports.publish(owner, tiles));
					}
				}).pipe(lock.withPermits(1)),
		);
		const catalog = Effect.fn("ObsService.catalog")(
			(sceneUuid = ""): Effect.Effect<ObsCatalog, ObsError> =>
				Effect.gen(function* () {
					const scenes = yield* request("GetSceneList"),
						inputs = yield* request("GetInputList"),
						transitions = yield* request("GetSceneTransitionList"),
						special = yield* request("GetSpecialInputs");
					const items = sceneUuid
						? yield* request("GetSceneItemList", { sceneUuid })
						: {};
					const decoded = yield* Schema.decodeUnknown(ObsCatalog)({
						scenes: scenes.scenes,
						inputs: inputs.inputs,
						transitions: transitions.transitions,
						items: items.sceneItems ?? [],
					}).pipe(
						Effect.catchTag("ParseError", () =>
							Effect.fail(new ObsConfigurationRejected()),
						),
					);
					const names = Object.values(special).filter(
						(name): name is string =>
							typeof name === "string" && name.length > 0,
					);
					return {
						...decoded,
						inputs: [
							...decoded.inputs.map((input) => ({
								...input,
								special: names.includes(input.inputName),
							})),
							...names
								.filter(
									(name) =>
										!decoded.inputs.some((input) => input.inputName === name),
								)
								.map((name) => ({
									inputUuid: name,
									inputName: name,
									inputKind: "special_audio",
									special: true,
								})),
						],
					};
				}).pipe(lock.withPermits(1)),
		);
		const initialize = Effect.fn("ObsService.initialize")(
			(): Effect.Effect<void> =>
				Effect.gen(function* () {
					if (started) return;
					started = true;
					yield* detect();
					if (config.autoConnect) yield* connect();
				}).pipe(Effect.tapError(failure), Effect.ignore),
		);
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				generation++;
				visible.clear();
				close();
			}),
		);
		yield* Effect.forkScoped(
			Effect.sleep(2000).pipe(
				Effect.zipRight(poll().pipe(Effect.repeat(Schedule.fixed(2000)))),
			),
		);
		yield* Effect.forkScoped(
			Effect.forever(
				Effect.sleep(1000).pipe(
					Effect.zipRight(
						Effect.gen(function* () {
							if (
								started &&
								config.autoConnect &&
								!manualDisconnect &&
								!blocked &&
								!connection?.connected() &&
								(yield* Clock.currentTimeMillis) >= nextRetry
							) {
								yield* Effect.suspend(() =>
									blocked || manualDisconnect || connection?.connected()
										? Effect.void
										: connectUnlocked().pipe(Effect.asVoid),
								).pipe(
									Effect.tapError(failure),
									Effect.ignore,
									lock.withPermits(1),
								);
							}
						}),
					),
				),
			),
		);
		return {
			status,
			configure,
			detect,
			connect,
			disconnect,
			execute,
			setVisible,
			release,
			poll,
			initialize,
			catalog,
		};
	}),
}) {}
