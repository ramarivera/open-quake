import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, it } from "vitest";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import {
	type IconPack,
	parseIconPack,
	svgData,
} from "../key-library/icon-packs";
import { iconStore } from "../key-library/icon-store";
import { iconZip } from "../test/icon-pack-fixtures";
import { readBackup, writeBackup } from "./backup-archive";
import { exportBackup, prepareRestore } from "./backup-store";

const asset = (id: string, color: string) => ({
	id,
	name: color,
	tags: ["synthetic"],
	data: svgData(
		`<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="${color}"/></svg>`,
	),
});
const incoming: readonly IconPack[] = [
	{ id: "installed", name: "Imported pack", icons: [asset("unused", "red")] },
	{
		id: "local",
		name: "Local App Icons",
		icons: [asset("local-icon", "blue")],
	},
];
async function fixture() {
	const scratch = await mkdtemp(join(tmpdir(), "oq-icon-backup-"));
	const source = join(scratch, "source");
	const destination = join(scratch, "destination");
	for (const root of [source, destination]) {
		await mkdir(root);
		await writeFile(
			join(root, "profiles-v1.json"),
			JSON.stringify(encodeProfileEnvelope(createInitialProfileEnvelope())),
		);
	}
	await Effect.runPromise(
		iconStore(join(source, "key-library-v1.json")).write(incoming),
	);
	return { scratch, source, destination };
}

for (const populated of [false, true])
	it(`restores installed and local unused icons through a fresh store, populated=${populated}`, async () => {
		const f = await fixture();
		try {
			const previous: readonly IconPack[] = [
				{
					id: "installed",
					name: "Destination name",
					icons: [asset("unused", "green")],
				},
				{
					id: "local",
					name: "Local App Icons",
					icons: [asset("local-icon", "yellow")],
				},
				{ id: "other", name: "Keep me", icons: [asset("keep", "black")] },
			];
			if (populated)
				await Effect.runPromise(
					iconStore(join(f.destination, "key-library-v1.json")).write(previous),
				);
			const archive = await exportBackup(f.source);
			const files = await readBackup(archive, "icons.zip");
			expect(
				JSON.parse(
					Buffer.from(
						files.get("open-quake/key-library-v1.json") ?? [],
					).toString(),
				),
			).toEqual(incoming);
			await rm(f.source, { recursive: true });
			const restore = await prepareRestore(archive, "icons.zip");
			await restore.validate(f.destination);
			await restore.commit(f.destination);
			const restored = await Effect.runPromise(
				iconStore(join(f.destination, "key-library-v1.json")).read(),
			);
			if (!populated) expect(restored).toEqual(incoming);
			else {
				expect(restored.find((pack) => pack.id === "other")).toEqual(
					previous[2],
				);
				for (const pack of restored.slice(0, 2)) {
					expect(pack.icons).toHaveLength(2);
					expect(new Set(pack.icons.map((icon) => icon.id)).size).toBe(2);
				}
				expect(restored[0]?.icons.map((icon) => icon.data)).toEqual([
					previous[0]?.icons[0]?.data,
					incoming[0]?.icons[0]?.data,
				]);
			}
			await restore.validate(f.destination);
			await restore.commit(f.destination);
			expect(
				await Effect.runPromise(
					iconStore(join(f.destination, "key-library-v1.json")).read(),
				),
			).toEqual(restored);
		} finally {
			await rm(f.scratch, { recursive: true, force: true });
		}
	});

for (const value of [
	{ invalid: true },
	[{ ...incoming[0], icons: [{ id: "x" }] }],
	[incoming[0], incoming[0]],
]) {
	it("rejects malformed/ambiguous icon stores on export, archive validation and destination validation", async () => {
		const f = await fixture();
		try {
			const archive = await exportBackup(f.source);
			const malformed = JSON.stringify(value);
			await writeFile(join(f.source, "key-library-v1.json"), malformed);
			await expect(exportBackup(f.source)).rejects.toBeDefined();
			const files = new Map(await readBackup(archive, "icons.zip"));
			files.set("open-quake/key-library-v1.json", Buffer.from(malformed));
			await expect(
				prepareRestore(await writeBackup(files, "default"), "bad.zip"),
			).rejects.toBeDefined();
			await writeFile(join(f.destination, "key-library-v1.json"), malformed);
			const restore = await prepareRestore(archive, "icons.zip");
			const before = await readFile(join(f.destination, "profiles-v1.json"));
			await expect(restore.validate(f.destination)).rejects.toBeDefined();
			await expect(restore.commit(f.destination)).rejects.toBeDefined();
			expect(await readFile(join(f.destination, "profiles-v1.json"))).toEqual(
				before,
			);
			expect(
				await readFile(join(f.destination, "key-library-v1.json"), "utf8"),
			).toBe(malformed);
		} finally {
			await rm(f.scratch, { recursive: true, force: true });
		}
	});
}

it("preserves the destination library for older archives and rejects symlink destinations", async () => {
	const f = await fixture();
	try {
		await rm(join(f.source, "key-library-v1.json"));
		const archive = await exportBackup(f.source);
		const path = join(f.destination, "key-library-v1.json");
		await Effect.runPromise(iconStore(path).write(incoming));
		const restore = await prepareRestore(archive, "old.zip");
		await restore.validate(f.destination);
		await restore.commit(f.destination);
		expect(await Effect.runPromise(iconStore(path).read())).toEqual(incoming);
		await rm(path);
		await writeFile(join(f.scratch, "outside"), JSON.stringify(incoming));
		await symlink(join(f.scratch, "outside"), path);
		await expect(restore.validate(f.destination)).rejects.toBeDefined();
		await expect(restore.commit(f.destination)).rejects.toBeDefined();
	} finally {
		await rm(f.scratch, { recursive: true, force: true });
	}
});

for (const populated of [false, true])
	it(`backs up real imported artwork aliases and restores them stably, populated=${populated}`, async () => {
		const f = await fixture();
		try {
			const svg =
				'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M0 0h8v8z" fill="red"/></svg>';
			const pack = await parseIconPack(
				iconZip([
					{ name: "manifest.json", data: JSON.stringify({ Name: "Aliases" }) },
					{
						name: "icons.json",
						data: JSON.stringify([
							{ path: "first.svg", name: "First", tags: ["one"] },
							{ path: "second.svg", name: "Second", tags: ["two"] },
							{ path: "first.svg", name: "First", tags: ["one"] },
						]),
					},
					{ name: "icons/first.svg", data: svg },
					{ name: "icons/second.svg", data: svg },
				]),
				() => {
					throw new Error("Unexpected raster");
				},
			);
			expect(pack.icons).toHaveLength(3);
			expect(new Set(pack.icons.map((icon) => icon.id)).size).toBe(1);
			await Effect.runPromise(
				iconStore(join(f.source, "key-library-v1.json")).add(pack),
			);
			const sourceBefore = await readFile(
				join(f.source, "key-library-v1.json"),
				"utf8",
			);
			const archive = await exportBackup(f.source);
			expect(
				await readFile(join(f.source, "key-library-v1.json"), "utf8"),
			).toBe(sourceBefore);
			const archived = await readBackup(archive, "aliases.zip");
			expect(
				JSON.parse(
					Buffer.from(
						archived.get("open-quake/key-library-v1.json") ?? [],
					).toString(),
				).find((stored: IconPack) => stored.id === pack.id),
			).toEqual(pack);
			if (populated)
				await Effect.runPromise(
					iconStore(join(f.destination, "key-library-v1.json")).write([
						{
							...pack,
							icons: [...pack.icons.slice(1), ...pack.icons.slice(0, 1)],
						},
						...incoming,
					]),
				);
			const restore = await prepareRestore(archive, "aliases.zip");
			await restore.validate(f.destination);
			await restore.commit(f.destination);
			const restored = await Effect.runPromise(
				iconStore(join(f.destination, "key-library-v1.json")).read(),
			);
			const aliases = restored.find((value) => value.id === pack.id);
			expect(aliases?.icons).toHaveLength(2);
			expect(aliases?.icons.map((icon) => icon.name).sort()).toEqual([
				"First",
				"Second",
			]);
			expect(aliases?.icons.map((icon) => icon.tags).sort()).toEqual([
				["one"],
				["two"],
			]);
			expect(new Set(aliases?.icons.map((icon) => icon.id)).size).toBe(2);
			expect(
				aliases?.icons.every((icon) => icon.data === pack.icons[0]?.data),
			).toBe(true);
			for (const library of incoming)
				expect(restored.find((value) => value.id === library.id)).toEqual(
					library,
				);
			const before = await readFile(
				join(f.destination, "key-library-v1.json"),
				"utf8",
			);
			await restore.validate(f.destination);
			await restore.commit(f.destination);
			expect(
				await readFile(join(f.destination, "key-library-v1.json"), "utf8"),
			).toBe(before);
		} finally {
			await rm(f.scratch, { recursive: true, force: true });
		}
	});
