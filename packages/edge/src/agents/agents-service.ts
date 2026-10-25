import { Effect, Option, Redacted, Schema } from "effect";
import {
	AgentCommand,
	AgentId,
	type AgentState,
	type AgentView,
	type ModelRow,
	type PanelProgress,
} from "./agents-contracts.js";
import {
	AgentCredentialUnavailable,
	AgentDraftFailed,
	AgentDraftUnavailable,
	AgentDuplicate,
	type AgentError,
	AgentInvalid,
	AgentMissing,
	AgentModelInvalid,
	AgentModelLastRow,
	AgentProfileMissing,
	AgentProtected,
	AgentRevisionConflict,
	AgentRollbackFailed,
	SkillConflict,
	SkillMoved,
	SkillMoveIncomplete,
	SkillWorkspaceInvalid,
} from "./agents-errors.js";
import {
	modelValid,
	normalizeRoles,
	ownModelRows,
	resolveModels,
	skillFrontMatter,
	workspaceTemplates,
} from "./agents-invariants.js";
import {
	AgentCredentialPort,
	AgentDraftPort,
	type AgentMutation,
	AgentPanelPort,
} from "./agents-ports.js";
import { AgentsRepository } from "./agents-repository.js";
import { AgentsRuntime } from "./agents-runtime.js";
import { providerDefaults } from "./provider-defaults.js";
export class AgentsService extends Effect.Service<AgentsService>()(
	"AgentsService",
	{
		accessors: true,
		dependencies: [AgentsRepository.Default, AgentsRuntime.Default],
		effect: Effect.gen(function* () {
			const repository = yield* AgentsRepository;
			const mutationLock = yield* Effect.makeSemaphore(1);
			const runtime = yield* AgentsRuntime;
			const draft = yield* Effect.serviceOption(AgentDraftPort);
			const credentials = yield* Effect.serviceOption(AgentCredentialPort);
			const panel = yield* Effect.serviceOption(AgentPanelPort);
			let progress: PanelProgress = {
				percent: 0,
				stage: "idle",
				deviceApplied: false,
			};
			const listeners = new Set<() => void>();
			const progressListeners = new Set<(progress: PanelProgress) => void>();
			const notify = Effect.sync(() => {
				for (const listener of listeners) listener();
			});
			const updateProgress = (next: PanelProgress) =>
				Effect.sync(() => {
					progress = next;
					for (const listener of progressListeners) listener(next);
				});
			const view = Effect.fn("AgentsService.view")(
				function* (): Effect.fn.Return<AgentView, AgentError> {
					const state = yield* repository.read();
					const models: Record<
						string,
						readonly (typeof AgentView.Type.models)[string][number][]
					> = {};
					for (const [scope, rows] of Object.entries(state.models)) {
						models[scope] = yield* Effect.forEach(rows, (row) =>
							Effect.gen(function* () {
								const { credentialRef, ...publicRow } = row;
								const credentialAvailable =
									credentialRef !== "" && Option.isSome(credentials)
										? yield* credentials.value.available(credentialRef)
										: false;
								return { ...publicRow, credentialAvailable };
							}),
						);
					}
					return {
						...state,
						models,
						runtime: yield* runtime.read(),
						progress,
						draftingAvailable: Option.isSome(draft),
					};
				},
			);
			const pendingCredentialCleanup = new Set<string>();
			const credentialRefs = (state: AgentState) =>
				new Set(
					Object.values(state.models)
						.flatMap((rows) => rows.map((row) => row.credentialRef))
						.filter(Boolean),
				);
			const retireCredentials = (used: ReadonlySet<string>) =>
				Effect.gen(function* () {
					if (Option.isNone(credentials)) return;
					for (const reference of pendingCredentialCleanup) {
						if (used.has(reference)) {
							pendingCredentialCleanup.delete(reference);
							continue;
						}
						yield* credentials.value.remove(reference).pipe(
							Effect.matchEffect({
								onSuccess: () =>
									Effect.sync(() => {
										pendingCredentialCleanup.delete(reference);
									}),
								// A committed edit remains committed. Retain the ref for retry, and report
								// only a stable diagnostic. Native keychain errors can contain secrets.
								onFailure: () =>
									Effect.logWarning(
										"Agent credential cleanup failed; retry pending",
									).pipe(
										Effect.annotateLogs({
											code: "AGENT.CREDENTIAL.UNAVAILABLE",
											operation: "retire-credential",
										}),
									),
							}),
						);
					}
				});
			const transactModels = (mutate: AgentMutation) =>
				Effect.uninterruptible(
					Effect.gen(function* () {
						let before = new Set<string>();
						const committed = yield* repository.transact((state) => {
							before = credentialRefs(state);
							return mutate(state);
						});
						const used = credentialRefs(committed);
						for (const reference of before)
							if (!used.has(reference)) pendingCredentialCleanup.add(reference);
						yield* retireCredentials(used);
						return committed;
					}),
				);
			const check = (
				state: AgentState,
				revision: number,
			): Effect.Effect<void, AgentRevisionConflict> =>
				state.revision === revision
					? Effect.void
					: Effect.fail(new AgentRevisionConflict());
			const editable = (state: AgentState, id: string) =>
				id === "main"
					? Effect.fail(new AgentProtected())
					: state.agents.some((a) => a.id === id)
						? Effect.void
						: Effect.fail(new AgentMissing());
			const scopeExists = (state: AgentState, scope: string) =>
				scope === "default" || state.agents.some((a) => a.id === scope);
			const request = Effect.fn("AgentsService.request")(function* (
				input: unknown,
			): Effect.fn.Return<{ view: AgentView; draft: string }, AgentError> {
				const command = yield* Schema.decodeUnknown(AgentCommand)(input, {
					onExcessProperty: "error",
				}).pipe(
					Effect.catchTag("ParseError", (cause) =>
						Effect.fail(new AgentInvalid(cause)),
					),
				);
				let draftText = "";
				switch (command.type) {
					case "read":
						break;
					case "runtime":
						yield* runtime.control(command.action);
						break;
					case "create":
						yield* repository.transact((state) =>
							Effect.gen(function* () {
								if (command.id === "main" || command.id === "default")
									return yield* new AgentProtected();
								if (state.agents.some((a) => a.id === command.id))
									return yield* new AgentDuplicate();
								return {
									...state,
									agents: [
										...state.agents,
										{
											id: command.id,
											name: command.name,
											emoji: command.emoji || "🤖",
											files: workspaceTemplates(
												command.name,
												command.emoji || "🤖",
											),
										},
									],
								};
							}),
						);
						break;
					case "delete": {
						let rollback: Effect.Effect<void, AgentError> = Effect.void;
						yield* Effect.uninterruptible(
							transactModels((state) =>
								Effect.gen(function* () {
									yield* editable(state, command.id);
									if (!command.confirmed) return yield* new AgentInvalid();

									const models = Object.fromEntries(
										Object.entries(state.models).filter(
											([key]) => key !== command.id,
										),
									);
									const next: AgentState = {
										...state,
										agents: state.agents.filter((a) => a.id !== command.id),
										skills: state.skills.filter((s) => s.owner !== command.id),
										slots: {
											"1,5":
												state.slots["1,5"] === command.id
													? Schema.decodeUnknownSync(AgentId)("main")
													: state.slots["1,5"],
											"1,6":
												state.slots["1,6"] === command.id
													? Schema.decodeUnknownSync(AgentId)("main")
													: state.slots["1,6"],
											"2,5":
												state.slots["2,5"] === command.id
													? Schema.decodeUnknownSync(AgentId)("main")
													: state.slots["2,5"],
											"2,6":
												state.slots["2,6"] === command.id
													? Schema.decodeUnknownSync(AgentId)("main")
													: state.slots["2,6"],
										},
										models,
									};
									if (Object.values(state.slots).includes(command.id)) {
										if (Option.isNone(panel))
											return yield* new AgentProfileMissing();
										const transaction = yield* panel.value.prepare(
											next.slots,
											next.agents,
										);
										rollback = transaction.rollback;
										yield* transaction.apply;
									}
									return next;
								}),
							).pipe(
								Effect.catchAll((error) =>
									rollback.pipe(
										Effect.catchAll((cause) =>
											Effect.fail(new AgentRollbackFailed(cause)),
										),
										Effect.zipRight(Effect.fail(error)),
									),
								),
							),
						);
						break;
					}
					case "save-file":
						yield* repository.transact((state) =>
							Effect.gen(function* () {
								yield* editable(state, command.id);
								yield* check(state, command.revision);
								return {
									...state,
									agents: state.agents.map((a) =>
										a.id === command.id
											? {
													...a,
													files: {
														...a.files,
														[command.file]: command.content,
													},
												}
											: a,
									),
								};
							}),
						);
						break;
					case "draft-agent": {
						if (Option.isNone(draft)) return yield* new AgentDraftUnavailable();
						const state = yield* repository.read();
						yield* check(state, command.revision);
						yield* editable(state, command.id);
						const agent = state.agents.find((a) => a.id === command.id);
						if (!agent) return yield* new AgentMissing();
						const generated = yield* draft.value
							.agent({ agent, prompt: command.prompt })
							.pipe(
								Effect.timeoutFail({
									duration: "60 seconds",
									onTimeout: () => new AgentDraftFailed(),
								}),
							);
						const files = yield* Schema.decodeUnknown(
							Schema.Record({
								key: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]+\.md$/)),
								value: Schema.String.pipe(Schema.maxLength(262144)),
							}),
						)(generated).pipe(
							Effect.catchTag("ParseError", (cause) =>
								Effect.fail(new AgentDraftFailed(cause)),
							),
						);
						if (Object.keys(files).length === 0)
							return yield* new AgentDraftFailed();
						yield* repository.transact((current) =>
							check(current, command.revision).pipe(
								Effect.as({
									...current,
									agents: current.agents.map((a) =>
										a.id === command.id
											? { ...a, files: { ...a.files, ...files } }
											: a,
									),
								}),
							),
						);
						break;
					}
					case "draft-skill": {
						if (Option.isNone(draft)) return yield* new AgentDraftUnavailable();
						draftText = yield* draft.value
							.skill({ name: command.name, prompt: command.prompt })
							.pipe(
								Effect.timeoutFail({
									duration: "60 seconds",
									onTimeout: () => new AgentDraftFailed(),
								}),
							);
						if (!skillFrontMatter(draftText))
							return yield* new AgentDraftFailed();
						break;
					}
					case "save-skill":
						yield* repository.transact((state) =>
							Effect.gen(function* () {
								yield* check(state, command.revision);
								if (
									command.owner === "main" ||
									(command.owner !== "" &&
										!state.agents.some((a) => a.id === command.owner))
								)
									return yield* new SkillWorkspaceInvalid();
								if (
									command.create &&
									state.skills.some(
										(s) =>
											s.folder === command.folder && s.owner === command.owner,
									)
								)
									return yield* new SkillConflict();
								if (
									!command.create &&
									!state.skills.some(
										(s) =>
											s.folder === command.folder && s.owner === command.owner,
									)
								)
									return yield* new SkillMoved();
								const meta = skillFrontMatter(command.content);
								if (!meta || meta.name !== command.name)
									return yield* new AgentInvalid();
								const skill = {
									folder: command.folder,
									owner: command.owner,
									name: meta.name,
									description: meta.description,
									content: command.content,
								};
								return {
									...state,
									skills: [
										...state.skills.filter(
											(s) =>
												s.folder !== command.folder ||
												s.owner !== command.owner,
										),
										skill,
									],
								};
							}),
						);
						break;
					case "delete-skill":
						yield* repository.transact((state) =>
							Effect.gen(function* () {
								yield* check(state, command.revision);
								if (!command.confirmed) return yield* new AgentInvalid();
								if (command.owner === "main")
									return yield* new AgentProtected();
								if (
									!state.skills.some(
										(s) =>
											s.folder === command.folder && s.owner === command.owner,
									)
								)
									return yield* new SkillMoved();
								return {
									...state,
									skills: state.skills.filter(
										(s) =>
											s.folder !== command.folder || s.owner !== command.owner,
									),
								};
							}),
						);
						break;
					case "move-skill":
						yield* repository
							.transact((state) =>
								Effect.gen(function* () {
									if (state.revision !== command.revision)
										return yield* new SkillMoved();
									if (
										command.owner === "main" ||
										command.target === "main" ||
										(command.target !== "" &&
											!state.agents.some((a) => a.id === command.target))
									)
										return yield* new SkillWorkspaceInvalid();
									if (
										!state.skills.some(
											(s) =>
												s.folder === command.folder &&
												s.owner === command.owner,
										)
									)
										return yield* new SkillMoved();
									if (
										command.owner === command.target ||
										state.skills.some(
											(s) =>
												s.folder === command.folder &&
												s.owner === command.target,
										)
									)
										return yield* new SkillConflict();
									return {
										...state,
										skills: state.skills.map((s) =>
											s.folder === command.folder && s.owner === command.owner
												? { ...s, owner: command.target }
												: s,
										),
									};
								}),
							)
							.pipe(
								Effect.catchTag("AgentStorageFailed", (cause) =>
									Effect.fail(new SkillMoveIncomplete(cause)),
								),
							);
						break;
					case "inherit":
						if (command.scope === "default") return yield* new AgentProtected();
						yield* transactModels((state) =>
							Effect.gen(function* () {
								yield* check(state, command.revision);
								if (!scopeExists(state, command.scope))
									return yield* new AgentMissing();
								return {
									...state,
									models: command.enabled
										? Object.fromEntries(
												Object.entries(state.models).filter(
													([key]) => key !== command.scope,
												),
											)
										: {
												...state.models,
												[command.scope]: (state.models.default ?? []).map(
													(r) => ({ ...r }),
												),
											},
								};
							}),
						);
						break;
					case "save-model": {
						let createdRef = "";
						let retainedRefs = new Set<string>();
						yield* transactModels((state) =>
							Effect.gen(function* () {
								retainedRefs = credentialRefs(state);
								yield* check(state, command.revision);
								if (!scopeExists(state, command.scope))
									return yield* new AgentMissing();
								const rows =
									ownModelRows(state.models, command.scope) ??
									ownModelRows(state.models, "default") ??
									[];
								const previous = rows.find((r) => r.id === command.row.id);
								const provider = command.row.provider.trim();
								let row: ModelRow = {
									...command.row,
									provider,
									model: command.row.model.trim(),
									baseUrl:
										command.row.baseUrl.trim() ||
										providerDefaults.find((p) => p.id === provider)?.baseUrl ||
										"",
									credentialRef: "",
								};
								// A key belongs to the saved provider endpoint, including its path.
								if (
									previous?.provider === provider &&
									previous.baseUrl === row.baseUrl
								)
									row = { ...row, credentialRef: previous.credentialRef };
								if (!modelValid(row)) return yield* new AgentModelInvalid();
								if (command.secret.trim()) {
									if (Option.isNone(credentials))
										return yield* new AgentCredentialUnavailable();
									createdRef = yield* credentials.value.store(
										Redacted.make(command.secret),
									);
									row = { ...row, credentialRef: createdRef };
								}
								const next = rows.some((r) => r.id === row.id)
									? rows.map((r) => (r.id === row.id ? row : r))
									: [...rows, row];
								const withUrl = next.map((r) =>
									r.provider === provider && r.baseUrl !== row.baseUrl
										? { ...r, baseUrl: row.baseUrl, credentialRef: "" }
										: r,
								);
								return {
									...state,
									models: {
										...state.models,
										[command.scope]: normalizeRoles(withUrl, row.id),
									},
								};
							}),
						).pipe(
							Effect.onError(() =>
								createdRef
									? Effect.uninterruptible(
											Effect.gen(function* () {
												pendingCredentialCleanup.add(createdRef);
												yield* retireCredentials(retainedRefs);
											}),
										)
									: Effect.void,
							),
						);
						break;
					}
					case "delete-model":
						yield* transactModels((state) =>
							Effect.gen(function* () {
								yield* check(state, command.revision);
								if (!command.confirmed) return yield* new AgentInvalid();
								const rows = ownModelRows(state.models, command.scope);
								if (!rows?.some((r) => r.id === command.id))
									return yield* new AgentModelInvalid();
								if (command.scope === "default" && rows.length <= 1)
									return yield* new AgentModelLastRow();
								return {
									...state,
									models: {
										...state.models,
										[command.scope]: normalizeRoles(
											rows.filter((r) => r.id !== command.id),
											"",
										),
									},
								};
							}),
						);
						break;
					case "sync-panel": {
						if (Option.isNone(panel)) return yield* new AgentProfileMissing();
						const panelPort = panel.value;
						let rollback: Effect.Effect<void, AgentError> = Effect.void;
						yield* updateProgress({
							percent: 5,
							stage: "preflight",
							deviceApplied: false,
						});
						const outcome = yield* repository
							.transact((state) =>
								Effect.gen(function* () {
									yield* check(state, command.revision);
									if (
										Object.values(command.slots).some(
											(id) => !state.agents.some((a) => a.id === id),
										)
									)
										return yield* new AgentMissing();
									const transaction = yield* panelPort.prepare(
										command.slots,
										state.agents,
									);
									rollback = transaction.rollback;
									yield* updateProgress({
										percent: 40,
										stage: "profile",
										deviceApplied: false,
									});
									const deviceApplied = yield* transaction.apply;
									yield* updateProgress({
										percent: 80,
										stage: "device",
										deviceApplied,
									});
									return { ...state, slots: command.slots };
								}),
							)
							.pipe(Effect.either);
						if (outcome._tag === "Left") {
							const restored = yield* rollback.pipe(Effect.either);
							yield* updateProgress({ ...progress, stage: "error" });
							if (restored._tag === "Left")
								return yield* new AgentRollbackFailed(restored.left);
							return yield* outcome.left;
						}
						yield* updateProgress({ ...progress, percent: 100, stage: "done" });
						break;
					}
				}
				yield* notify;
				return { view: yield* view(), draft: draftText };
			}, mutationLock.withPermits(1));
			return {
				view,
				request,
				subscribeProgress: (
					listener: (progress: PanelProgress) => void,
				): (() => void) => {
					progressListeners.add(listener);
					return () => {
						progressListeners.delete(listener);
					};
				},
				resolve: Effect.fn("AgentsService.resolve")(function* (
					id: string,
				): Effect.fn.Return<readonly ModelRow[], AgentError> {
					return resolveModels(yield* repository.read(), id);
				}),
				subscribe: (listener: () => void): (() => void) => {
					listeners.add(listener);
					const off = runtime.subscribe(listener);
					return () => {
						listeners.delete(listener);
						off();
					};
				},
			};
		}),
	},
) {}
