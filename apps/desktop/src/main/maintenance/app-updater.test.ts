import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Option } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { AppUpdateFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import type { AppRelease } from "../../../../../packages/edge/src/maintenance/update-service.js";
import { ownedAppUpdater } from "./app-updater";

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
	const install = vi.fn(async (_path: string, _release: AppRelease) => {});
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
	return { root, port, transport, install };
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
		join(f.root, `app-update-${release.sha256}.artifact`),
		release,
	);
	expect(await readFile(f.install.mock.calls[0]?.[0] ?? "")).toEqual(bytes);
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
