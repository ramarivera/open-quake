import { createHash, generateKeyPairSync, sign } from "node:crypto";
import * as files from "node:fs/promises";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Option } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { AppUpdateFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import type { AppRelease } from "../../../../../packages/edge/src/maintenance/update-service.js";
import { ownedAppUpdater, type VerifiedUpdateArtifact } from "./app-updater";

vi.mock("node:fs/promises", async (original) => {
	const actual = await original<typeof import("node:fs/promises")>();
	return { ...actual, mkdtemp: vi.fn(actual.mkdtemp) };
});
const key = generateKeyPairSync("ed25519");
const bytes = Buffer.from("synthetic installer fixture, never executable");
const release: AppRelease = {
	app: "open-quake",
	version: "1.1.0",
	platform: process.platform,
	arch: process.arch,
	sha256: createHash("sha256").update(bytes).digest("hex"),
	bytes: bytes.length,
	artifact: "https://artifacts.invalid/fixture",
};
const roots: string[] = [];
afterEach(async () => {
	for (const path of roots.splice(0))
		await rm(path, { recursive: true, force: true });
	vi.restoreAllMocks();
});
async function fixture(
	changes: Readonly<Record<string, unknown>> = {},
	invalidSignature = false,
) {
	const root = await mkdtemp(join(tmpdir(), "owned-update-fake-"));
	roots.push(root);
	const payload = JSON.stringify({ ...release, ...changes });
	const envelope = JSON.stringify({
		payload,
		signature: sign(
			null,
			Buffer.from(invalidSignature ? "other metadata" : payload),
			key.privateKey,
		).toString("base64"),
	});
	const transport = vi.fn<typeof fetch>(async () => new Response(envelope));
	const installed: Buffer[] = [];
	const install = vi.fn(
		async (artifact: VerifiedUpdateArtifact, _release: AppRelease) => {
			const buffer = Buffer.alloc(bytes.length);
			expect(await artifact.read(buffer, 0)).toBe(bytes.length);
			installed.push(buffer);
		},
	);
	const port = ownedAppUpdater({
		root,
		currentVersion: "1.0.0",
		platform: process.platform,
		arch: process.arch,
		configuration: {
			feed: "https://feed.invalid/latest",
			artifactOrigin: "https://artifacts.invalid",
			publicKey: key.publicKey
				.export({ format: "pem", type: "spki" })
				.toString(),
			fetch: transport,
			install,
		},
	});
	return { root, port, transport, install, installed };
}
it("uses no network or installer with the default disabled owned policy", async () => {
	const transport = vi.spyOn(globalThis, "fetch");
	const port = ownedAppUpdater({
		root: "unused",
		currentVersion: "1.0.0",
		platform: process.platform,
		arch: process.arch,
	});
	expect(port.enabled).toBe(false);
	expect(Option.isNone(await Effect.runPromise(port.check()))).toBe(true);
	expect(
		(
			await Effect.runPromise(
				port.download(release, () => {}).pipe(Effect.either),
			)
		)._tag,
	).toBe("Left");
	expect(
		(await Effect.runPromise(port.install(release).pipe(Effect.either)))._tag,
	).toBe("Left");
	expect(transport).not.toHaveBeenCalled();
});
it("verifies signed owned release, reports progress and rechecks private cached bytes before fake install", async () => {
	const f = await fixture();
	expect(await Effect.runPromise(f.port.check())).toEqual(Option.some(release));
	f.transport.mockResolvedValueOnce(new Response(bytes));
	const progress: number[] = [];
	await Effect.runPromise(f.port.download(release, (n) => progress.push(n)));
	expect(progress.at(-1)).toBe(1);
	expect(f.install).not.toHaveBeenCalled();
	await Effect.runPromise(f.port.install(release));
	expect(f.install).toHaveBeenCalledWith(
		{ read: expect.any(Function) },
		release,
	);
	expect(f.installed).toEqual([bytes]);
	expect(f.transport).toHaveBeenLastCalledWith(
		release.artifact,
		expect.objectContaining({
			redirect: "error",
			credentials: "omit",
			signal: expect.any(AbortSignal),
		}),
	);
	await writeFile(
		join(f.root, `app-update-${release.sha256}.artifact`),
		Buffer.alloc(bytes.length, 0),
	);
	expect(
		(await Effect.runPromise(f.port.install(release).pipe(Effect.either)))._tag,
	).toBe("Left");
	expect(f.install).toHaveBeenCalledOnce();
});
for (const [name, changes, badSignature] of [
	["signature", {}, true],
	["foreign origin", { artifact: "https://foreign.invalid/file" }, false],
	["plain HTTP", { artifact: "http://artifacts.invalid/file" }, false],
	[
		"URL credential",
		{ artifact: "https://token@artifacts.invalid/file" },
		false,
	],
	["wrong app", { app: "other" }, false],
	["wrong platform", { platform: "other" }, false],
	["wrong architecture", { arch: "other" }, false],
	["malformed version", { version: "1.latest" }, false],
	["invalid length", { bytes: 0 }, false],
	["oversized length", { bytes: 256 * 1024 * 1024 + 1 }, false],
] as const) {
	it(`rejects ${name} before download`, async () => {
		// The wrong-app case deliberately crosses the unknown feed boundary.
		const f = await fixture(
			{ ...changes, ...("app" in changes ? { app: release.app } : {}) },
			badSignature,
		);
		if ("app" in changes) {
			const payload = JSON.stringify({ ...release, app: changes.app });
			f.transport.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						payload,
						signature: sign(
							null,
							Buffer.from(payload),
							key.privateKey,
						).toString("base64"),
					}),
				),
			);
		}
		const result = await Effect.runPromise(f.port.check().pipe(Effect.either));
		expect(result._tag).toBe("Left");
		if (result._tag === "Left")
			expect(result.left.code).toBe("QUAKE.APP.UPDATE_FAILED");
		expect(f.install).not.toHaveBeenCalled();
	});
}
for (const body of [
	Buffer.from("wrong artifact"),
	Buffer.alloc(bytes.length + 1),
	Buffer.alloc(bytes.length),
]) {
	it(`rejects corrupt or wrong-length download ${body.length}`, async () => {
		const f = await fixture();
		await Effect.runPromise(f.port.check());
		f.transport.mockResolvedValueOnce(new Response(body));
		const result = await Effect.runPromise(
			f.port.download(release, () => {}).pipe(Effect.either),
		);
		expect(result._tag).toBe("Left");
		expect(
			(await Effect.runPromise(f.port.install(release).pipe(Effect.either)))
				._tag,
		).toBe("Left");
		expect(f.install).not.toHaveBeenCalled();
	});
}
it("preserves original dependency error privately and scrubs response/installer failures", async () => {
	const f = await fixture();
	await Effect.runPromise(f.port.check());
	f.transport.mockResolvedValueOnce(new Response(bytes));
	await Effect.runPromise(f.port.download(release, () => {}));
	const cause = new Error("synthetic/private?token=secret");
	f.install.mockRejectedValueOnce(cause);
	const result = await Effect.runPromise(
		f.port.install(release).pipe(Effect.either),
	);
	expect(result._tag).toBe("Left");
	if (result._tag === "Left") {
		expect(result.left).toBeInstanceOf(AppUpdateFailed);
		expect(result.left.originalCause).toBe(cause);
		expect(JSON.stringify(result.left)).not.toMatch(/secret|private/);
	}
});

for (const replacement of [bytes, Buffer.alloc(bytes.length)]) {
	it(`refuses a cache inode swap between verification and installer handoff even with matching bytes ${replacement[0]}`, async () => {
		const f = await fixture();
		await Effect.runPromise(f.port.check());
		f.transport.mockResolvedValueOnce(new Response(bytes));
		await Effect.runPromise(f.port.download(release, () => {}));
		const make = files.mkdtemp;
		vi.spyOn(files, "mkdtemp").mockImplementationOnce(
			async (prefix, options) => {
				const path = join(f.root, `app-update-${release.sha256}.artifact`);
				await rename(path, `${path}.old`);
				await writeFile(path, replacement);
				return make(prefix, options);
			},
		);
		expect(
			(await Effect.runPromise(f.port.install(release).pipe(Effect.either)))
				._tag,
		).toBe("Left");
		expect(f.install).not.toHaveBeenCalled();
	});
}
it("hands off only a readable private copy, so replacing the cache during install cannot change its bytes", async () => {
	const f = await fixture();
	await Effect.runPromise(f.port.check());
	f.transport.mockResolvedValueOnce(new Response(bytes));
	await Effect.runPromise(f.port.download(release, () => {}));
	f.install.mockImplementationOnce(async (artifact) => {
		await writeFile(
			join(f.root, `app-update-${release.sha256}.artifact`),
			Buffer.alloc(bytes.length),
		);
		const buffer = Buffer.alloc(bytes.length);
		expect(await artifact.read(buffer, 0)).toBe(bytes.length);
		expect(buffer).toEqual(bytes);
		expect(Object.keys(artifact)).toEqual(["read"]);
	});
	await Effect.runPromise(f.port.install(release));
});

it("streams reusable chunks to disk and hashes files with bounded allocations and no full concatenation", async () => {
	const chunk = Buffer.alloc(65536, 7);
	const digest = createHash("sha256");
	for (let n = 0; n < 16; n++) digest.update(chunk);
	const big = {
		...release,
		bytes: chunk.length * 16,
		sha256: digest.digest("hex"),
	};
	const f = await fixture(big);
	await Effect.runPromise(f.port.check());
	let remaining = 16;
	f.transport.mockResolvedValueOnce(
		new Response(
			new ReadableStream<Uint8Array>(
				{
					pull(controller) {
						if (!remaining--) return controller.close();
						chunk.fill(7);
						controller.enqueue(chunk);
					},
				},
				{ highWaterMark: 0 },
			),
		),
	);
	const allocate = Buffer.alloc;
	const allocations = vi.spyOn(Buffer, "alloc").mockImplementation((size) => {
		expect(size).toBeLessThanOrEqual(65536);
		return allocate(size);
	});
	const concatenate = vi.spyOn(Buffer, "concat");
	await Effect.runPromise(f.port.download(big, () => chunk.fill(0)));
	f.install.mockImplementationOnce(async (artifact) => {
		const first = Buffer.alloc(1);
		expect(await artifact.read(first, 0)).toBe(1);
		expect(first[0]).toBe(7);
	});
	await Effect.runPromise(f.port.install(big));
	expect(allocations).toHaveBeenCalled();
	expect(concatenate).not.toHaveBeenCalled();
});

it("prunes superseded artifacts after successful download and installation, preserving unrelated files and failed-download recovery", async () => {
	const f = await fixture();
	const old = `app-update-${"a".repeat(64)}.artifact`;
	const linked = `app-update-${"b".repeat(64)}.artifact`;
	const directory = `app-update-${"c".repeat(64)}.artifact`;
	await writeFile(join(f.root, old), "old synthetic installer");
	await writeFile(join(f.root, "settings.json"), "keep");
	await symlink(join(f.root, "settings.json"), join(f.root, linked));
	await mkdir(join(f.root, directory));
	await Effect.runPromise(f.port.check());
	f.transport.mockResolvedValueOnce(new Response("corrupt"));
	expect(
		(
			await Effect.runPromise(
				f.port.download(release, () => {}).pipe(Effect.either),
			)
		)._tag,
	).toBe("Left");
	expect(await readdir(f.root)).toContain(old);
	f.transport.mockResolvedValueOnce(new Response(bytes));
	await Effect.runPromise(f.port.download(release, () => {}));
	expect(await readdir(f.root)).not.toContain(old);
	await writeFile(join(f.root, old), "superseded synthetic installer");
	await Effect.runPromise(f.port.install(release));
	expect(await readdir(f.root)).toEqual(
		expect.arrayContaining([
			linked,
			directory,
			"settings.json",
			`app-update-${release.sha256}.artifact`,
		]),
	);
	expect(await readdir(f.root)).not.toContain(old);
	expect(await readFile(join(f.root, "settings.json"), "utf8")).toBe("keep");
});
