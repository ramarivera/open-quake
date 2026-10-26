import { Effect, Layer, ManagedRuntime } from "effect";
import { expect, it } from "vitest";
import {
	type ShortcutPortShape,
	ShortcutPorts,
	ShortcutService,
} from "./shortcut-service";

it("MGMT-108 saves, updates, renames, reloads and deletes a generated library without executing it", async () => {
	let disk: unknown = { version: 1, libraries: [] };
	let nextId = 0;
	let failWrite = false;
	let syncCalls = 0;
	const ports: ShortcutPortShape = {
		store: {
			read: async () => disk,
			write: async (value) => {
				if (failWrite) throw Error("Synthetic write failure");
				disk = value;
			},
		},
		id: () => `id-${++nextId}`,
		now: () => "2026-10-26",
		draft: async () =>
			JSON.stringify({
				ConfigTitle: "Editing",
				ConfigData: [
					{
						title: "Copy",
						config: {
							functionType: "hotkey",
							actions: [{ type: "key", value: "control+c" }],
						},
					},
				],
			}),
		sync: async () => {
			syncCalls++;
			return "profile";
		},
	};
	const layer = ShortcutService.Default.pipe(
		Layer.provide(Layer.succeed(ShortcutPorts, ports)),
	);
	const runtime = ManagedRuntime.make(layer);
	try {
		await runtime.runPromise(
			Effect.gen(function* () {
				const draft = yield* ShortcutService.generate("Editor", "Copy text");
				const saved = (yield* ShortcutService.save({
					id: "",
					name: draft.title,
					app: "Editor",
					createdAt: "",
					rows: draft.rows,
				}))[0];
				if (!saved) throw Error("Missing saved library");
				const updated = (yield* ShortcutService.save({
					...saved,
					name: "Editing two",
					rows: saved.rows.map((row) => ({ ...row, name: "Copy text" })),
				}))[0];
				expect(updated).toMatchObject({
					id: saved.id,
					name: "Editing two",
					createdAt: saved.createdAt,
				});
				expect(yield* ShortcutService.list()).toEqual([updated]);
				failWrite = true;
				expect(
					(yield* Effect.either(
						ShortcutService.save({ ...saved, name: "Unsaved" }),
					))._tag,
				).toBe("Left");
				expect(yield* ShortcutService.list()).toEqual([updated]);
				failWrite = false;
				expect(yield* ShortcutService.remove(saved.id)).toEqual([]);
				expect(yield* ShortcutService.list()).toEqual([]);
			}),
		);
		expect(syncCalls).toBe(0);
	} finally {
		await runtime.dispose();
	}
	const reloaded = ManagedRuntime.make(layer);
	try {
		expect(await reloaded.runPromise(ShortcutService.list())).toEqual([]);
	} finally {
		await reloaded.dispose();
	}
});
