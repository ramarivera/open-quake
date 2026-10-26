import { Context, Effect, Schema } from "effect";
import { maskSecret } from "../channels/channel-catalog.js";
import type {
	CredentialVault,
	JsonStore,
} from "../channels/channel-contracts.js";
import {
	CredentialFailed,
	HaAuthenticationFailed,
	HaCertificateRejected,
	HaNetworkFailed,
	InputRejected,
	type IntegrationError,
	IntegrationErrors,
	ProfilePlacementFailed,
	StoreFailed,
} from "../channels/integration-errors.js";
import {
	type Certificate,
	type Entity,
	type HaConnection,
	HaKey,
	type HaLive,
	type HaService,
	type HaSnapshot,
	HaStore,
	type HaTarget,
	type Json,
} from "./ha-contracts.js";
import {
	defaultAllowlist,
	haOrigin,
	validateHaAction,
	validateHaKey,
} from "./ha-invariants.js";
export interface HaPortShape {
	readonly store: JsonStore;
	readonly vault: CredentialVault;
	readonly open: (
		origin: string,
		token: string,
		trust: readonly Certificate[],
		allowInsecureHttp: boolean,
	) => Promise<HaConnection>;
	readonly place: (target: HaTarget, key: HaKey) => Promise<void>;
}
export class HaPorts extends Context.Tag("integrations/HaPorts")<
	HaPorts,
	HaPortShape
>() {}
export const haBoundaryError = (cause: unknown): IntegrationError =>
	cause instanceof HaCertificateRejected ||
	cause instanceof HaAuthenticationFailed ||
	cause instanceof InputRejected
		? cause
		: new HaNetworkFailed(cause);
export class HomeAssistantService extends Effect.Service<HomeAssistantService>()(
	"integrations/HomeAssistantService",
	{
		accessors: true,
		scoped: Effect.gen(function* () {
			const ports = yield* HaPorts;
			const lock = yield* Effect.makeSemaphore(1);
			let connection: HaConnection | undefined;
			let state: HaSnapshot["state"] = "Disconnected";
			let reason = "";
			let certificate: Certificate | null = null;
			let entities: readonly Entity[] = [];
			let services: readonly HaService[] = [];
			let visible: readonly string[] = [];
			let visibilityRevision = 0;
			let live: readonly Entity[] = [];
			const load = Effect.fn("HomeAssistantService.load")(
				function* (): Effect.fn.Return<HaStore, IntegrationError> {
					const raw = yield* Effect.tryPromise({
						try: ports.store.read,
						catch: (c) => new StoreFailed(c),
					});
					return yield* Schema.decodeUnknown(HaStore)(raw).pipe(
						Effect.catchTag("ParseError", (c) =>
							Effect.fail(new StoreFailed(c)),
						),
					);
				},
			);
			const persist = (config: HaStore) =>
				Effect.tryPromise({
					try: () => ports.store.write(config),
					catch: (c) => new StoreFailed(c),
				});
			const snapshot = Effect.fn("HomeAssistantService.snapshot")(
				function* (): Effect.fn.Return<HaSnapshot, IntegrationError> {
					const config = yield* load();
					return {
						origin: config.origin,
						tokenMask: config.tokenMask,
						state,
						reason,
						certificate,
						trusted: config.trusted,
						entities,
						services,
						allowlist: config.allowlist ?? defaultAllowlist(entities),
					};
				},
			);
			const disconnect = () => {
				connection?.close();
				connection = undefined;
				state = "Disconnected";
				live = [];
				entities = [];
				services = [];
				reason = "";
				certificate = null;
			};
			const recordFailure = (error: IntegrationError) =>
				Effect.sync(() => {
					disconnect();
					state = "Failed";
					reason = IntegrationErrors[error._tag].message;
					certificate =
						error instanceof HaCertificateRejected
							? { origin: error.origin, fingerprint: error.fingerprint }
							: null;
				});
			const connect = Effect.fn("HomeAssistantService.connect")(
				(
					address: string,
					token: string,
					allowInsecureHttp = false,
				): Effect.Effect<HaSnapshot, IntegrationError> =>
					Effect.gen(function* () {
						disconnect();
						state = "Connecting";
						reason = "";
						certificate = null;
						entities = [];
						services = [];
						const origin = yield* Effect.try({
							try: () => haOrigin(address),
							catch: (c) =>
								c instanceof InputRejected ? c : new InputRejected(c),
						});
						if (origin.startsWith("http:") && !allowInsecureHttp)
							return yield* Effect.fail(
								new InputRejected(undefined, "Unencrypted HTTP consent"),
							);
						let config = yield* load();
						if (token) {
							const reference = yield* Effect.tryPromise({
								try: () => ports.vault.put(token),
								catch: (c) => new CredentialFailed(c),
							});
							const old = config;
							config = {
								...config,
								origin,
								credentialRef: reference,
								tokenMask: maskSecret(token),
							};
							yield* persist(config).pipe(
								Effect.tapError(() =>
									Effect.tryPromise({
										try: () => ports.vault.remove(reference),
										catch: (c) => new CredentialFailed(c),
									}),
								),
							);
							if (old.credentialRef)
								yield* Effect.tryPromise({
									try: () => ports.vault.remove(old.credentialRef),
									catch: (c) => new CredentialFailed(c),
								});
						} else {
							if (origin !== config.origin || !config.credentialRef)
								return yield* Effect.fail(new HaAuthenticationFailed());
						}
						const secret = yield* Effect.tryPromise({
							try: () => ports.vault.get(config.credentialRef),
							catch: (c) => new CredentialFailed(c),
						});
						const next = yield* Effect.tryPromise({
							try: () =>
								ports.open(origin, secret, config.trusted, allowInsecureHttp),
							catch: haBoundaryError,
						});
						connection = next;
						entities = yield* Effect.tryPromise({
							try: next.entities,
							catch: haBoundaryError,
						});
						services = yield* Effect.tryPromise({
							try: next.services,
							catch: haBoundaryError,
						});
						state = "Connected";
						live = entities.filter((e) => visible.includes(e.entity_id));
						return yield* snapshot();
					}).pipe(Effect.tapError(recordFailure), lock.withPermits(1)),
			);
			yield* Effect.addFinalizer(() => Effect.sync(disconnect));
			return {
				snapshot,
				connect,
				trust: Effect.fn("HomeAssistantService.trust")(
					(
						candidate: Certificate,
					): Effect.Effect<HaSnapshot, IntegrationError> =>
						Effect.gen(function* () {
							if (
								!certificate ||
								candidate.origin !== certificate.origin ||
								candidate.fingerprint !== certificate.fingerprint ||
								!candidate.fingerprint
							)
								return yield* Effect.fail(
									new InputRejected(undefined, "certificate"),
								);
							const config = yield* load();
							yield* persist({
								...config,
								trusted: [
									...config.trusted.filter(
										(c) => c.origin !== candidate.origin,
									),
									candidate,
								],
							});
							return yield* snapshot();
						}).pipe(lock.withPermits(1)),
				),
				revoke: Effect.fn("HomeAssistantService.revoke")(
					(origin: string): Effect.Effect<HaSnapshot, IntegrationError> =>
						Effect.gen(function* () {
							const config = yield* load();
							disconnect();
							yield* persist({
								...config,
								trusted: config.trusted.filter((c) => c.origin !== origin),
							});
							return yield* snapshot();
						}).pipe(lock.withPermits(1)),
				),
				allowlist: Effect.fn("HomeAssistantService.allowlist")(
					(
						ids: readonly string[],
					): Effect.Effect<HaSnapshot, IntegrationError> =>
						Effect.gen(function* () {
							const selected = [...new Set(ids)].filter((id) =>
								entities.some((e) => e.entity_id === id),
							);
							if (!selected.length)
								return yield* Effect.fail(
									new InputRejected(undefined, "AI-Perceivable Entity"),
								);
							const config = yield* load();
							yield* persist({ ...config, allowlist: selected });
							return yield* snapshot();
						}).pipe(lock.withPermits(1)),
				),
				aiEntities: Effect.fn("HomeAssistantService.aiEntities")(
					function* (): Effect.fn.Return<readonly Entity[], IntegrationError> {
						const config = yield* load();
						const allowed = config.allowlist ?? defaultAllowlist(entities);
						return state === "Connected"
							? entities.filter((e) => allowed.includes(e.entity_id))
							: [];
					},
				),
				saveKey: Effect.fn("HomeAssistantService.saveKey")(
					(
						target: HaTarget,
						input: unknown,
					): Effect.Effect<void, IntegrationError> =>
						Effect.gen(function* () {
							if (state !== "Connected")
								return yield* Effect.fail(new HaNetworkFailed());
							const key = yield* Schema.decodeUnknown(HaKey)(input, {
								onExcessProperty: "error",
							}).pipe(
								Effect.catchTag("ParseError", (c) =>
									Effect.fail(new InputRejected(c, "Display Info")),
								),
							);
							yield* Effect.try({
								try: () => validateHaKey(key, entities, services),
								catch: (c) =>
									c instanceof InputRejected ? c : new InputRejected(c),
							});
							yield* Effect.tryPromise({
								try: () => ports.place(target, key),
								catch: (c) => new ProfilePlacementFailed(c),
							});
						}).pipe(lock.withPermits(1)),
				),
				execute: Effect.fn("HomeAssistantService.execute")(
					(
						key: HaKey,
						fromAi = false,
						isCurrent: () => boolean = () => true,
					): Effect.Effect<void, IntegrationError> =>
						Effect.gen(function* () {
							const active = connection;
							if (!active || state !== "Connected")
								return yield* Effect.fail(new HaNetworkFailed());
							yield* Effect.try({
								try: () => validateHaAction(key, entities, services),
								catch: (c) =>
									c instanceof InputRejected ? c : new InputRejected(c),
							});
							if (fromAi) {
								const allowed = yield* load();
								if (
									!(allowed.allowlist ?? defaultAllowlist(entities)).includes(
										key.entity_id,
									)
								)
									return yield* Effect.fail(
										new InputRejected(undefined, "AI-Perceivable Entity"),
									);
							}
							const data: Readonly<Record<string, Json>> = {
								...key.service_data,
								entity_id: key.entity_id,
							};
							yield* Effect.suspend(() => {
								// Recheck after the semaphore and allowlist wait, at dispatch.
								if (!isCurrent())
									return Effect.fail(
										new InputRejected(undefined, "Assistant turn"),
									);
								return Effect.tryPromise({
									try: () =>
										active.execute(
											key.entity_id.split(".")[0] ?? "",
											key.service,
											data,
										),
									catch: haBoundaryError,
								}).pipe(Effect.tapError(recordFailure));
							});
						}).pipe(lock.withPermits(1)),
				),
				setVisible: Effect.fn("HomeAssistantService.setVisible")(
					(ids: readonly string[]): Effect.Effect<void> =>
						Effect.sync(() => {
							visible = [...new Set(ids)];
							visibilityRevision++;
							live = live.filter((e) => visible.includes(e.entity_id));
						}),
				),
				poll: Effect.fn("HomeAssistantService.poll")(
					(): Effect.Effect<HaLive, IntegrationError> =>
						Effect.gen(function* () {
							const active = connection;
							if (!active || state !== "Connected")
								return { connected: false, states: [] };
							if (visible.length) {
								const revision = visibilityRevision;
								const requested = visible;
								const updated = yield* Effect.tryPromise({
									try: () => active.states(requested),
									catch: haBoundaryError,
								}).pipe(Effect.tapError(recordFailure));
								if (revision !== visibilityRevision)
									return { connected: state === "Connected", states: live };
								live = updated;
								const updates = new Map(live.map((e) => [e.entity_id, e]));
								entities = entities.map((e) => updates.get(e.entity_id) ?? e);
							} else live = [];
							return { connected: true, states: live };
						}).pipe(lock.withPermits(1)),
				),
				live: Effect.fn("HomeAssistantService.live")(
					(): Effect.Effect<HaLive> =>
						Effect.sync(() => ({
							connected: state === "Connected",
							states: live,
						})),
				),
				dispose: Effect.fn("HomeAssistantService.dispose")(
					(): Effect.Effect<void> => Effect.sync(disconnect),
				),
			};
		}),
	},
) {}
