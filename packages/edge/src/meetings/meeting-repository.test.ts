import { Effect, ManagedRuntime } from "effect";
import { expect, it } from "vitest";
import { meetingError } from "./meeting-errors.js";
import { MeetingRepository } from "./meeting-repository.js";

it("acquires without reading meeting files and retries before mutations without overwriting unreadable data", async () => {
	let broken = true;
	let reads = 0;
	let writes = 0;
	const error = meetingError(
		"StorageFailed",
		new Error("private meeting path"),
	);
	const runtime = ManagedRuntime.make(
		MeetingRepository.Default({
			load: () =>
				Effect.suspend(() => {
					reads++;
					return broken
						? Effect.fail(error)
						: Effect.succeed({ version: 1, records: [] });
				}),
			save: () =>
				Effect.sync(() => {
					writes++;
				}),
			remove: () =>
				Effect.sync(() => {
					writes++;
				}),
			deleteAudio: () => Effect.void,
		}),
	);
	try {
		await runtime.runtime();
		expect(reads).toBe(0);
		const failed = await runtime.runPromise(
			Effect.flatMap(MeetingRepository, (s) =>
				Effect.either(s.update(() => [])),
			),
		);
		expect(failed).toMatchObject({ _tag: "Left", left: { code: error.code } });
		expect(writes).toBe(0);
		broken = false;
		const results = await Promise.all(
			Array.from({ length: 8 }, () =>
				runtime.runPromise(MeetingRepository.list()),
			),
		);
		expect(results).toEqual(Array.from({ length: 8 }, () => []));
		expect(reads).toBe(2);
		expect(writes).toBe(0);
	} finally {
		await runtime.dispose();
	}
});
