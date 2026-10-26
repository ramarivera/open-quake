import { Context, Effect, Schema } from "effect";
import type { JsonStore } from "../channels/channel-contracts.js";
import {
	DraftUnavailable,
	InputRejected,
	type IntegrationError,
	ProfilePlacementFailed,
	StoreFailed,
} from "../channels/integration-errors.js";
import {
	type DraftResult,
	ShortcutLibrary,
	ShortcutStore,
} from "./shortcut-contracts.js";
import {
	decodeDraft,
	normalizeChord,
	validLibraryName,
} from "./shortcut-invariants.js";
export interface ShortcutPortShape {
	readonly store: JsonStore;
	readonly id: () => string;
	readonly now: () => string;
	readonly draft?: (request: string, signal?: AbortSignal) => Promise<string>;
	readonly sync: (library: ShortcutLibrary) => Promise<string>;
}
export class ShortcutPorts extends Context.Tag("integrations/ShortcutPorts")<
	ShortcutPorts,
	ShortcutPortShape
>() {}
export class ShortcutService extends Effect.Service<ShortcutService>()(
	"integrations/ShortcutService",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const ports = yield* ShortcutPorts;
			const lock = yield* Effect.makeSemaphore(1);
			const list = Effect.fn("ShortcutService.list")(
				function* (): Effect.fn.Return<
					readonly ShortcutLibrary[],
					IntegrationError
				> {
					const raw = yield* Effect.tryPromise({
						try: ports.store.read,
						catch: (c) => new StoreFailed(c),
					});
					return (yield* Schema.decodeUnknown(ShortcutStore)(raw).pipe(
						Effect.catchTag("ParseError", (c) =>
							Effect.fail(new StoreFailed(c)),
						),
					)).libraries;
				},
			);
			const persist = (libraries: readonly ShortcutLibrary[]) =>
				Effect.tryPromise({
					try: () => ports.store.write({ version: 1, libraries }),
					catch: (c) => new StoreFailed(c),
				});
			return {
				list,
				available: !!ports.draft,
				generate: Effect.fn("ShortcutService.generate")(function* (
					app: string,
					prompt: string,
				): Effect.fn.Return<DraftResult, IntegrationError> {
					if (!prompt.trim())
						return yield* Effect.fail(
							new InputRejected(
								undefined,
								"Please describe the shortcuts to generate",
							),
						);
					if (!app.trim() || prompt.length > 180 || app.length > 100)
						return yield* Effect.fail(new InputRejected(undefined, "prompt"));
					const draft = ports.draft;
					if (!draft) return yield* Effect.fail(new DraftUnavailable());
					const text = yield* Effect.tryPromise({
						try: (signal) => draft(`${app.trim()}：${prompt.trim()}`, signal),
						catch: (c) => new DraftUnavailable(c),
					});
					return yield* Effect.try({
						try: () => decodeDraft(text, app, ports.id),
						catch: (c) =>
							c instanceof InputRejected ? c : new InputRejected(c),
					});
				}),
				save: Effect.fn("ShortcutService.save")(
					(
						input: unknown,
					): Effect.Effect<readonly ShortcutLibrary[], IntegrationError> =>
						Effect.gen(function* () {
							const library = yield* Schema.decodeUnknown(ShortcutLibrary)(
								input,
								{ onExcessProperty: "error" },
							).pipe(
								Effect.catchTag("ParseError", (c) =>
									Effect.fail(new InputRejected(c)),
								),
							);
							if (!validLibraryName(library.name))
								return yield* Effect.fail(
									new InputRejected(undefined, "Invalid name"),
								);
							const rows = yield* Effect.try({
								try: () =>
									library.rows.map((row, index) => ({
										...row,
										name: row.name.trim() || `Shortcut ${index + 1}`,
										chord: normalizeChord(row.chord),
									})),
								catch: (c) =>
									c instanceof InputRejected ? c : new InputRejected(c),
							});
							if (new Set(rows.map((r) => r.id)).size !== rows.length)
								return yield* Effect.fail(
									new InputRejected(undefined, "row id"),
								);
							const all = yield* list();
							const old = all.find((l) => l.id === library.id);
							const next = {
								...library,
								id: old?.id ?? ports.id(),
								createdAt: old?.createdAt ?? ports.now(),
								rows,
							};
							const libraries = old
								? all.map((l) => (l.id === old.id ? next : l))
								: [...all, next];
							yield* persist(libraries);
							return libraries;
						}).pipe(lock.withPermits(1)),
				),
				remove: Effect.fn("ShortcutService.remove")(
					(
						id: string,
					): Effect.Effect<readonly ShortcutLibrary[], IntegrationError> =>
						Effect.gen(function* () {
							const libraries = (yield* list()).filter((l) => l.id !== id);
							yield* persist(libraries);
							return libraries;
						}).pipe(lock.withPermits(1)),
				),
				sync: Effect.fn("ShortcutService.sync")(
					(id: string): Effect.Effect<string, IntegrationError> =>
						Effect.gen(function* () {
							const library = (yield* list()).find((l) => l.id === id);
							if (!library?.rows.length)
								return yield* Effect.fail(
									new InputRejected(undefined, "This library has no shortcuts"),
								);
							return yield* Effect.tryPromise({
								try: () => ports.sync(library),
								catch: (c) =>
									c instanceof InputRejected
										? c
										: new ProfilePlacementFailed(c),
							});
						}).pipe(lock.withPermits(1)),
				),
			};
		}),
	},
) {}
