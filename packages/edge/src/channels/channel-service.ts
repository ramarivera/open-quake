import { Context, Effect, Fiber, Schema, Scope } from "effect";
import {
	CHANNEL_CATALOG,
	channelDescriptor,
	credentialFields,
} from "./channel-catalog.js";
import {
	type ChannelConfig,
	type ChannelId,
	type ChannelRuntime,
	ChannelStore,
	type ChannelView,
	type CredentialVault,
	type JsonStore,
	type Pairing,
	type QrSession,
} from "./channel-contracts.js";
import {
	CredentialFailed,
	InputRejected,
	type IntegrationError,
	RuntimeUnavailable,
	StoreFailed,
} from "./integration-errors.js";
export interface ChannelPortShape {
	readonly store: JsonStore;
	readonly vault: CredentialVault;
	readonly runtime: ChannelRuntime;
	readonly now: () => number;
	readonly id: () => string;
}
export class ChannelPorts extends Context.Tag("integrations/ChannelPorts")<
	ChannelPorts,
	ChannelPortShape
>() {}
const runtimeCall = <A>(run: () => Promise<A>) =>
	Effect.tryPromise({
		try: run,
		catch: (cause) => new RuntimeUnavailable(cause),
	});
export class ChannelService extends Effect.Service<ChannelService>()(
	"integrations/ChannelService",
	{
		accessors: true,
		scoped: Effect.gen(function* () {
			const ports = yield* ChannelPorts;
			const scope = yield* Scope.Scope;
			const lock = yield* Effect.makeSemaphore(1);
			const sessions = new Map<
				string,
				{
					view: QrSession;
					cancel: () => void;
					expiry?: Fiber.RuntimeFiber<void, never>;
				}
			>();
			const approvals = new Set<string>();
			const secrets = new Set<string>();
			const loadStore = Effect.fn("ChannelService.loadStore")(
				function* (): Effect.fn.Return<
					typeof ChannelStore.Type,
					IntegrationError
				> {
					const raw = yield* Effect.tryPromise({
						try: ports.store.read,
						catch: (c) => new StoreFailed(c),
					});
					const data = yield* Schema.decodeUnknown(ChannelStore)(raw).pipe(
						Effect.catchTag("ParseError", (c) =>
							Effect.fail(new StoreFailed(c)),
						),
					);
					return data;
				},
			);
			const load = () =>
				loadStore().pipe(Effect.map((data) => [...data.channels]));
			const write = (
				channels: readonly ChannelConfig[],
				pendingCredentialRefs?: readonly string[],
			) =>
				Effect.gen(function* () {
					const pending =
						pendingCredentialRefs ?? (yield* loadStore()).pendingCredentialRefs;
					yield* Effect.tryPromise({
						try: () =>
							ports.store.write({
								version: 1,
								channels,
								pendingCredentialRefs: pending,
							}),
						catch: (c) => new StoreFailed(c),
					});
				});
			// Called under the mutation lock. References remain durable until vault cleanup succeeds.
			const cleanup = () =>
				Effect.gen(function* () {
					const data = yield* loadStore();
					for (const ref of data.pendingCredentialRefs) {
						yield* Effect.tryPromise({
							try: () => ports.vault.remove(ref),
							catch: (c) => new CredentialFailed(c),
						});
					}
					if (data.pendingCredentialRefs.length)
						yield* write(data.channels, []);
				});
			const readCredentials = (ref: string) =>
				Effect.tryPromise({
					try: async () =>
						Schema.decodeUnknownSync(
							Schema.Record({ key: Schema.String, value: Schema.String }),
						)(JSON.parse(await ports.vault.get(ref))),
					catch: (c) => new CredentialFailed(c),
				}).pipe(
					Effect.tap((values) =>
						Effect.sync(() => {
							for (const value of Object.values(values))
								if (value) secrets.add(value);
						}),
					),
				);
			const list = Effect.fn("ChannelService.list")(
				function* (): Effect.fn.Return<
					readonly ChannelView[],
					IntegrationError
				> {
					const all = yield* load();
					const runtime = yield* runtimeCall(ports.runtime.status).pipe(
						Effect.catchTag(
							"RuntimeUnavailable",
							(): Effect.Effect<
								Awaited<ReturnType<ChannelRuntime["status"]>>
							> =>
								Effect.succeed({
									available: false,
									reason: "OpenClaw runtime is unavailable",
									connected: [],
								}),
						),
					);
					return CHANNEL_CATALOG.map((d) => {
						const config = all.find((c) => c.id === d.id);
						return {
							id: d.id,
							configured: !!config,
							enabled: config?.enabled ?? false,
							publicFields: config?.publicFields ?? {},
							reason: runtime.available
								? ""
								: "OpenClaw runtime is unavailable",
							state: !runtime.available
								? "Unavailable"
								: !config
									? "Not configured"
									: !config.enabled
										? "Disabled"
										: runtime.connected.includes(d.id)
											? "Connected"
											: "Configured",
						};
					});
				},
			);
			const cancelQr = Effect.fn("ChannelService.cancelQr")(
				(id: string): Effect.Effect<void> =>
					Effect.gen(function* () {
						const session = sessions.get(id);
						if (!session) return;
						sessions.delete(id);
						if (session.expiry) yield* Fiber.interrupt(session.expiry);
						session.cancel();
					}),
			);

			const save = Effect.fn("ChannelService.save")(
				(
					id: ChannelId,
					fields: Readonly<Record<string, string>>,
					sessionId = "",
				): Effect.Effect<readonly ChannelView[], IntegrationError> =>
					Effect.gen(function* () {
						const all = yield* load();
						const old = all.find((c) => c.id === id);
						const descriptor = channelDescriptor(id);
						if (!descriptor)
							return yield* Effect.fail(
								new InputRejected(undefined, "channel"),
							);
						const qr = sessions.get(sessionId)?.view;
						if (
							descriptor.setupType === "qr_login" &&
							(qr?.channelId !== id ||
								qr.state !== "confirmed" ||
								qr.expiresAt <= ports.now())
						)
							return yield* Effect.fail(
								new InputRejected(undefined, "QR login"),
							);
						const publicFields: Record<string, string> = {};
						const privateFields: Record<string, string> = {};
						for (const field of credentialFields(id)) {
							const supplied = fields[field.key]?.trim() ?? "";
							const value =
								supplied ||
								(field.secret && old
									? ((yield* readCredentials(old.credentialRef))[field.key] ??
										"")
									: "");
							if (!value)
								return yield* Effect.fail(
									new InputRejected(undefined, field.label),
								);
							if (field.secret) {
								privateFields[field.key] = value;
								secrets.add(value);
							} else publicFields[field.key] = value;
						}
						if (id === "feishu") {
							if (fields.domain !== "feishu" && fields.domain !== "lark")
								return yield* Effect.fail(
									new InputRejected(undefined, "Domain"),
								);
							Object.assign(publicFields, {
								domain: fields.domain,
								dmPolicy: "pairing",
								groupPolicy: "allowlist",
								requireMention: "true",
							});
						}
						if (descriptor.setupType === "qr_login")
							publicFields.dmPolicy = "pairing";
						const ref = yield* Effect.tryPromise({
							try: () => ports.vault.put(JSON.stringify(privateFields)),
							catch: (c) => new CredentialFailed(c),
						});
						const config: ChannelConfig = {
							id,
							enabled: true,
							credentialRef: ref,
							publicFields,
						};
						yield* write(
							[...all.filter((c) => c.id !== id), config],
							[
								...(yield* loadStore()).pendingCredentialRefs,
								...(old?.credentialRef ? [old.credentialRef] : []),
							],
						).pipe(
							Effect.tapError(() =>
								Effect.tryPromise({
									try: () => ports.vault.remove(ref),
									catch: (c) => new CredentialFailed(c),
								}),
							),
						);
						// A save is durable even if the runtime is stopped. Only its status can verify connectivity.
						yield* runtimeCall(() =>
							ports.runtime.configure(config, privateFields),
						).pipe(Effect.catchTag("RuntimeUnavailable", () => Effect.void));
						yield* cleanup();
						if (sessionId) yield* cancelQr(sessionId);
						return yield* list();
					}).pipe(lock.withPermits(1)),
			);
			const dispose = Effect.fn("ChannelService.dispose")(
				(): Effect.Effect<void> =>
					Effect.sync(() => {
						for (const session of sessions.values()) session.cancel();
						sessions.clear();
						secrets.clear();
					}),
			);
			yield* Effect.addFinalizer(() => dispose());
			return {
				list,
				save,
				setEnabled: Effect.fn("ChannelService.setEnabled")(
					(
						id: ChannelId,
						enabled: boolean,
					): Effect.Effect<readonly ChannelView[], IntegrationError> =>
						Effect.gen(function* () {
							const all = yield* load();
							const old = all.find((c) => c.id === id);
							if (!old)
								return yield* Effect.fail(
									new InputRejected(undefined, "channel"),
								);
							const updated = { ...old, enabled };
							yield* write(all.map((c) => (c.id === id ? updated : c)));
							const credentials = yield* Effect.tryPromise({
								try: async () =>
									Schema.decodeUnknownSync(
										Schema.Record({ key: Schema.String, value: Schema.String }),
									)(JSON.parse(await ports.vault.get(old.credentialRef))),
								catch: (c) => new CredentialFailed(c),
							});
							yield* runtimeCall(() =>
								ports.runtime.configure(updated, credentials),
							).pipe(Effect.catchTag("RuntimeUnavailable", () => Effect.void));
							return yield* list();
						}).pipe(lock.withPermits(1)),
				),
				remove: Effect.fn("ChannelService.remove")(
					(
						id: ChannelId,
					): Effect.Effect<readonly ChannelView[], IntegrationError> =>
						Effect.gen(function* () {
							const all = yield* load();
							const old = all.find((c) => c.id === id);
							yield* runtimeCall(() => ports.runtime.remove(id)).pipe(
								Effect.catchTag("RuntimeUnavailable", () => Effect.void),
							);
							yield* write(
								all.filter((c) => c.id !== id),
								[
									...(yield* loadStore()).pendingCredentialRefs,
									...(old ? [old.credentialRef] : []),
								],
							);
							yield* cleanup();
							for (const [key, s] of sessions)
								if (s.view.channelId === id) yield* cancelQr(key);
							return yield* list();
						}).pipe(lock.withPermits(1)),
				),
				startQr: Effect.fn("ChannelService.startQr")(function* (
					id: ChannelId,
				): Effect.fn.Return<QrSession, IntegrationError> {
					if (channelDescriptor(id)?.setupType !== "qr_login")
						return yield* Effect.fail(new InputRejected(undefined, "QR login"));
					const runtime = yield* runtimeCall(ports.runtime.status);
					if (!runtime.available)
						return yield* Effect.fail(new RuntimeUnavailable());
					for (const [key, s] of sessions)
						if (s.view.channelId === id) yield* cancelQr(key);
					// Hydrate secrets before the runtime can emit, including credentials from previous sessions.
					for (const config of yield* load())
						yield* readCredentials(config.credentialRef);
					const key = ports.id();
					const state: {
						view: QrSession;
						cancel: () => void;
						expiry?: Fiber.RuntimeFiber<void, never>;
					} = {
						view: {
							id: key,
							channelId: id,
							expiresAt: ports.now() + 300000,
							state: "pending",
							image: "",
							url: "",
							lines: [],
						} satisfies QrSession,
						cancel: () => {},
					};
					sessions.set(key, state);
					const cancel = yield* runtimeCall(() =>
						ports.runtime.startQr(id, key, (progress) => {
							if (
								sessions.get(key) !== state ||
								ports.now() >= state.view.expiresAt
							)
								return;
							const url =
								progress.url &&
								URL.canParse(progress.url) &&
								new URL(progress.url).protocol === "https:" &&
								!new URL(progress.url).username
									? progress.url
									: state.view.url;
							const image =
								progress.image?.match(
									/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/,
								) && progress.image.length < 2000000
									? progress.image
									: state.view.image;
							const lines = (progress.lines ?? state.view.lines)
								.filter(
									(line) =>
										(line.match(/[█▀▄▌▐░▒▓■□▪▫\u2580-\u259f]/g) ?? []).length <
										4,
								)
								.slice(-6)
								.map((line) => {
									let clean = line;
									for (const secret of secrets)
										clean = clean.split(secret).join("••••");
									return clean
										.slice(0, 300)
										.replace(
											/(token|secret|password|authorization)\s*[:=]\s*\S+/gi,
											"$1=••••",
										);
								});
							state.view = {
								...state.view,
								url,
								image,
								lines,
								state: progress.failed
									? "failed"
									: progress.confirmed
										? "confirmed"
										: image || url
											? "ready"
											: state.view.state,
								expiresAt:
									progress.expiresAt === undefined
										? state.view.expiresAt
										: Math.min(state.view.expiresAt, progress.expiresAt),
							};
						}),
					).pipe(Effect.tapError(() => cancelQr(key)));
					let stopped = false;
					state.cancel = () => {
						if (stopped) return;
						stopped = true;
						cancel();
					};
					if (sessions.get(key) !== state) {
						state.cancel();
						return { ...state.view, state: "cancelled", image: "", url: "" };
					}
					if (state.view.state === "failed") state.cancel();
					state.expiry = yield* Effect.forkIn(
						Effect.sleep(Math.max(0, state.view.expiresAt - ports.now())).pipe(
							Effect.flatMap(() =>
								Effect.sync(() => {
									if (sessions.get(key) !== state) return;
									state.cancel();
									state.view = {
										...state.view,
										state: "expired",
										image: "",
										url: "",
									};
								}),
							),
						),
						scope,
					);
					return state.view;
				}),
				readQr: Effect.fn("ChannelService.readQr")(
					(id: string): Effect.Effect<QrSession, InputRejected> =>
						Effect.gen(function* () {
							const session = sessions.get(id);
							if (!session)
								return yield* Effect.fail(
									new InputRejected(undefined, "QR session"),
								);
							if (ports.now() >= session.view.expiresAt) {
								session.cancel();
								session.view = {
									...session.view,
									state: "expired",
									image: "",
									url: "",
								};
							}
							return session.view;
						}),
				),
				cancelQr,
				pairings: Effect.fn("ChannelService.pairings")(
					(
						id: ChannelId,
					): Effect.Effect<readonly Pairing[], RuntimeUnavailable> =>
						runtimeCall(() => ports.runtime.pairings(id)),
				),
				approve: Effect.fn("ChannelService.approve")(
					(
						id: ChannelId,
						code: string,
					): Effect.Effect<readonly Pairing[], IntegrationError> =>
						Effect.gen(function* () {
							const key = `${id}:${code}`;
							if (approvals.has(key))
								return yield* runtimeCall(() => ports.runtime.pairings(id));
							approvals.add(key);
							return yield* Effect.gen(function* () {
								const pending = yield* runtimeCall(() =>
									ports.runtime.pairings(id),
								);
								if (!pending.some((p) => p.code === code))
									return yield* Effect.fail(
										new InputRejected(undefined, "pairing code"),
									);
								yield* runtimeCall(() => ports.runtime.approve(id, code));
								return yield* runtimeCall(() => ports.runtime.pairings(id));
							}).pipe(
								Effect.ensuring(Effect.sync(() => approvals.delete(key))),
							);
						}),
				),
				dispose,
			};
		}),
	},
) {}
