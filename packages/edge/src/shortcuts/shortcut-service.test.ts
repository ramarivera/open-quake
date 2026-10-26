import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { expect, vi } from "vitest";
import { ShortcutPorts, ShortcutService } from "./shortcut-service.js";

it.effect(
	"CENTER-093 sends the exact trimmed app-prefixed prompt to the draft adapter",
	() => {
		const draft = vi.fn(async () => '{"ConfigTitle":"Editor","ConfigData":[]}');
		return Effect.gen(function* () {
			const service = yield* ShortcutService;
			expect(
				yield* service.generate(" My Editor ", " Format document "),
			).toMatchObject({ rows: [] });
			expect(draft).toHaveBeenCalledExactlyOnceWith(
				"My Editor：Format document",
				expect.any(AbortSignal),
			);
			for (const prompt of ["", " ", "x".repeat(181)]) {
				expect(
					(yield* service.generate("My Editor", prompt).pipe(Effect.either))
						._tag,
				).toBe("Left");
			}
			expect(draft).toHaveBeenCalledOnce();
		}).pipe(
			Effect.provide(
				ShortcutService.Default.pipe(
					Layer.provide(
						Layer.succeed(ShortcutPorts, {
							store: {
								read: async () => ({ version: 1, libraries: [] }),
								write: async () => {},
							},
							id: () => "synthetic",
							now: () => "2026-10-26T00:00:00Z",
							draft,
							sync: async () => "profile",
						}),
					),
				),
			),
		);
	},
);
