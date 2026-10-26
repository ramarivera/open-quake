import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { arrangementState } from "./arrangement-state";

it("MAIN-057 persists only the consented-success marker and reports corrupt restart state", async () => {
	const directory = await mkdtemp(join(tmpdir(), "quake-arrangement-"));
	try {
		const path = join(directory, "seed.json");
		const state = arrangementState(path);
		expect(await Effect.runPromise(state.read())).toBe(false);
		await Effect.runPromise(state.save());
		expect(await Effect.runPromise(arrangementState(path).read())).toBe(true);
		await writeFile(path, "broken");
		const failure = await Effect.runPromise(Effect.flip(state.read()));
		expect(failure.code).toBe("DESKTOP.DISPLAY.OPERATION_FAILED");
		expect(failure.originalCause).toBeDefined();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
