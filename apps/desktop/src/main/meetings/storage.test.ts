import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	Deferred,
	Effect,
	Either,
	Fiber,
	ManagedRuntime,
	Option,
} from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
	MeetingId,
	type MeetingRecord,
} from "../../../../../packages/edge/src/meetings/meeting-contracts";
import { defaultMeetingConfig } from "../../../../../packages/edge/src/meetings/meeting-defaults";
import { exportArtifact } from "../../../../../packages/edge/src/meetings/meeting-invariants";
import { MeetingRepository } from "../../../../../packages/edge/src/meetings/meeting-repository";
import { meetingStorage } from "./storage";

const directories: string[] = [];
const record: MeetingRecord = {
	id: MeetingId.make(crypto.randomUUID()),
	parentId: Option.none(),
	title: "Review/Plan",
	startedAt: 0,
	endedAt: Option.some(2000),
	state: "processing",
	audio: "complete",
	transcription: "complete",
	summary: "processing",
	marks: [],
	transcript: [
		{ id: "1", speaker: "2", startMs: 0, endMs: 1000, text: "Olá, 世界" },
	],
	minutes: "# Decisions\n\nShip Friday.",
	template: "executive",
	appliedTemplate: Option.some("executive"),
	provenance: Option.none(),
	errorCode: Option.none(),
	config: defaultMeetingConfig,
};
afterEach(async () => {
	for (const directory of directories.splice(0))
		await rm(directory, { force: true, recursive: true });
});
describe("native meeting storage", () => {
	it("saves regenerated text atomically, recovers interrupted work and independently reads exports", async () => {
		const root = await mkdtemp(join(tmpdir(), "oq-meetings-storage-"));
		directories.push(root);
		await Effect.runPromise(
			Effect.gen(function* () {
				const repo = yield* MeetingRepository;
				yield* repo.update(() => [record]);
			}).pipe(Effect.provide(MeetingRepository.Default(meetingStorage(root)))),
		);
		const saved = JSON.parse(
			await readFile(join(root, "history.json"), "utf8"),
		);
		expect(saved.records[0].minutes).toBe(record.minutes);
		const reloaded = await Effect.runPromise(
			MeetingRepository.list().pipe(
				Effect.provide(MeetingRepository.Default(meetingStorage(root))),
			),
		);
		expect(reloaded[0]?.state).toBe("interrupted");
		expect(reloaded[0]?.transcript).toEqual(record.transcript);
		expect(reloaded[0]?.minutes).toBe(record.minutes);
		for (const kind of ["summary", "transcript"] as const) {
			const artifact = exportArtifact(record, kind);
			const file = join(root, artifact.name);
			await writeFile(file, artifact.text, "utf8");
			expect(await readFile(file, "utf8")).toBe(artifact.text);
		}
	});
	it("does not replace valid history when staging fails and reports corrupt history", async () => {
		const root = await mkdtemp(join(tmpdir(), "oq-meetings-failure-"));
		directories.push(root);
		const store = meetingStorage(root);
		await Effect.runPromise(store.save({ version: 1, records: [] }));
		await rm(join(root, "history.staging.json"), { force: true });
		const { mkdir } = await import("node:fs/promises");
		await mkdir(join(root, "history.staging.json"));
		const failed = await Effect.runPromise(
			Effect.either(store.save({ version: 1, records: [] })),
		);
		expect(Either.isLeft(failed) && failed.left._tag).toBe(
			"MeetingStorageFailed",
		);
		expect(await readFile(join(root, "history.json"), "utf8")).toBe(
			'{"version":1,"records":[]}',
		);
		await writeFile(join(root, "history.json"), "corrupt private content");
		const load = await Effect.runPromise(
			Effect.either(
				MeetingRepository.list().pipe(
					Effect.provide(MeetingRepository.Default(store)),
				),
			),
		);
		expect(Either.isLeft(load)).toBe(true);
		expect(JSON.stringify(load)).not.toContain("private content");
	});
});

it("rolls back every staged audio folder when history commit fails", async () => {
	const { mkdir } = await import("node:fs/promises");
	const root = await mkdtemp(join(tmpdir(), "oq-meetings-delete-"));
	directories.push(root);
	const side = {
		...record,
		id: MeetingId.make(crypto.randomUUID()),
		parentId: Option.some(record.id),
	};
	await Effect.runPromise(
		Effect.gen(function* () {
			const repo = yield* MeetingRepository;
			yield* repo.update(() => [record, side]);
			for (const item of [record, side]) {
				yield* Effect.promise(async () => {
					await mkdir(join(root, item.id));
					await writeFile(join(root, item.id, "final_recording.mp3"), item.id);
				});
			}
			yield* Effect.promise(() => mkdir(join(root, "history.staging.json")));
			const result = yield* Effect.either(repo.remove([record.id, side.id]));
			expect(Either.isLeft(result)).toBe(true);
			expect(yield* repo.list()).toHaveLength(2);
		}).pipe(Effect.provide(MeetingRepository.Default(meetingStorage(root)))),
	);
	for (const item of [record, side])
		expect(
			await readFile(join(root, item.id, "final_recording.mp3"), "utf8"),
		).toBe(item.id);
});
it("rolls back an earlier parent rename when staging a later child fails", async () => {
	const { mkdir, symlink } = await import("node:fs/promises");
	const root = await mkdtemp(join(tmpdir(), "oq-meetings-stage-"));
	directories.push(root);
	const side = MeetingId.make(crypto.randomUUID());
	await mkdir(join(root, record.id));
	await writeFile(join(root, record.id, "final_recording.mp3"), "preserved");
	await symlink(join(root, record.id), join(root, side));
	const result = await Effect.runPromise(
		Effect.either(
			meetingStorage(root).remove({ version: 1, records: [] }, [
				record.id,
				side,
			]),
		),
	);
	expect(Either.isLeft(result)).toBe(true);
	expect(
		await readFile(join(root, record.id, "final_recording.mp3"), "utf8"),
	).toBe("preserved");
});
it("recovers staged audio by history membership after a crash before or after commit", async () => {
	const { mkdir, rename, access } = await import("node:fs/promises");
	const root = await mkdtemp(join(tmpdir(), "oq-meetings-crash-"));
	directories.push(root);
	const store = meetingStorage(root);
	await Effect.runPromise(
		Effect.gen(function* () {
			yield* (yield* MeetingRepository).update(() => [record]);
		}).pipe(Effect.provide(MeetingRepository.Default(store))),
	);
	await mkdir(join(root, record.id));
	await writeFile(join(root, record.id, "final_recording.mp3"), "preserved");
	await rename(join(root, record.id), join(root, ".deleting", record.id));
	await Effect.runPromise(store.load());
	expect(
		await readFile(join(root, record.id, "final_recording.mp3"), "utf8"),
	).toBe("preserved");
	await rename(join(root, record.id), join(root, ".deleting", record.id));
	await Effect.runPromise(store.save({ version: 1, records: [] }));
	await Effect.runPromise(store.load());
	await expect(access(join(root, ".deleting", record.id))).rejects.toThrow();
});

it("finishes committed deletion and the in-memory transition before interruption releases the lock", async () => {
	const root = await mkdtemp(join(tmpdir(), "oq-meetings-interrupt-"));
	directories.push(root);
	const committed = await Effect.runPromise(Deferred.make<void>()),
		release = await Effect.runPromise(Deferred.make<void>());
	const storage = meetingStorage(root);
	const runtime = ManagedRuntime.make(
		MeetingRepository.Default({
			...storage,
			remove: (store, ids) =>
				storage
					.remove(store, ids)
					.pipe(
						Effect.zipRight(Deferred.succeed(committed, undefined)),
						Effect.zipRight(Deferred.await(release)),
					),
		}),
	);
	try {
		await runtime.runPromise(MeetingRepository.update(() => [record]));
		const removal = runtime.runFork(MeetingRepository.remove([record.id]));
		await Effect.runPromise(Deferred.await(committed));
		const interrupted = runtime.runPromise(Fiber.interrupt(removal));
		await Effect.runPromise(Deferred.succeed(release, undefined));
		await interrupted;
		expect(await runtime.runPromise(MeetingRepository.list())).toEqual([]);
		expect(
			JSON.parse(await readFile(join(root, "history.json"), "utf8")).records,
		).toEqual([]);
	} finally {
		await Effect.runPromise(Deferred.succeed(release, undefined));
		await runtime.dispose();
	}
});
