import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Option } from "effect";
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
