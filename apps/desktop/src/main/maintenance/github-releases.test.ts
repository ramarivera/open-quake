import { createHash } from "node:crypto";
import {
	chmod,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { expect, it, vi } from "vitest";
import {
	AppUpdatePort,
	AppUpdates,
} from "../../../../../packages/edge/src/maintenance/update-service";
import { ownedAppUpdater } from "./app-updater";
import { githubAppImageConfiguration, RELEASES_PAGE } from "./github-releases";

async function fixture(overrides: Record<string, unknown> = {}) {
	const root = await mkdtemp(join(tmpdir(), "github-update-"));
	const image = join(root, "open-quake.AppImage");
	await writeFile(image, "old synthetic image");
	await chmod(image, 0o755);
	const bytes = Buffer.from("new synthetic image, never executed");
	const digest = createHash("sha256").update(bytes).digest("hex");
	const url = `${RELEASES_PAGE}/download/v1.1.0/open-quake-1.1.0-linux-arm64.AppImage`;
	const release = {
		tag_name: "v1.1.0",
		draft: false,
		prerelease: false,
		assets: [
			{
				name: "open-quake-1.1.0-linux-arm64.AppImage",
				size: bytes.length,
				digest: `sha256:${digest}`,
				browser_download_url: url,
				...overrides,
			},
		],
	};
	const transport = vi.fn<typeof fetch>(async (input) => {
		const url = String(input);
		if (url.startsWith("https://api.github.com/"))
			return Response.json(release);
		if (url.startsWith("https://github.com/"))
			return new Response(null, {
				status: 302,
				headers: {
					location: "https://release-assets.githubusercontent.com/owned/test",
				},
			});
		return new Response(bytes);
	});
	const restart = vi.fn();
	const configuration = githubAppImageConfiguration({
		arch: "arm64",
		image,
		fetch: transport,
		restart,
	});
	const port = ownedAppUpdater({
		root: join(root, "updates"),
		platform: "linux",
		arch: "arm64",
		currentVersion: "1.0.0",
		configuration,
	});
	return {
		root,
		image,
		bytes,
		release,
		transport,
		restart,
		port,
		layer: AppUpdates.Default.pipe(
			Layer.provide(Layer.succeed(AppUpdatePort, port)),
		),
	};
}
it("MAIN-114 real update service downloads the owned GitHub asset, verifies it and waits for explicit install", async () => {
	const f = await fixture();
	try {
		await Effect.runPromise(
			Effect.gen(function* () {
				const updates = yield* AppUpdates;
				yield* updates.check();
				expect(yield* updates.snapshot()).toMatchObject({
					state: "available",
					version: "1.1.0",
				});
				yield* updates.download();
				expect(yield* updates.snapshot()).toMatchObject({ state: "ready" });
				expect(yield* Effect.promise(() => readFile(f.image, "utf8"))).toBe(
					"old synthetic image",
				);
				expect(f.restart).not.toHaveBeenCalled();
				yield* updates.install();
			}).pipe(Effect.provide(f.layer), Effect.scoped),
		);
		expect(await readFile(f.image)).toEqual(f.bytes);
		expect((await stat(f.image)).mode & 0o777).toBe(0o755);
		expect(f.restart).toHaveBeenCalledOnce();
		expect(f.transport.mock.calls[0]?.[0]).toBe(
			"https://api.github.com/repos/ramarivera/open-quake/releases/latest",
		);
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});
it.each([
	{ digest: null },
	{
		browser_download_url:
			"https://github.com/foreign/app/releases/download/v1.1.0/app.AppImage",
	},
	{ digest: `sha256:${"0".repeat(64)}` },
])(
	"MAIN-114 rejects missing/untrusted/corrupt asset %j before replacement",
	async (overrides) => {
		const f = await fixture(overrides);
		try {
			const result = await Effect.runPromise(
				Effect.gen(function* () {
					const updates = yield* AppUpdates;
					yield* updates.check();
					yield* updates.download();
				}).pipe(Effect.provide(f.layer), Effect.scoped, Effect.either),
			);
			expect(result._tag).toBe("Left");
			expect(result._tag === "Left" && result.left.code).toBe(
				"QUAKE.APP.UPDATE_FAILED",
			);
			expect(await readFile(f.image, "utf8")).toBe("old synthetic image");
			expect(f.restart).not.toHaveBeenCalled();
		} finally {
			await rm(f.root, { recursive: true, force: true });
		}
	},
);
it("MAIN-114 refuses foreign redirects and preserves the installed image", async () => {
	const f = await fixture();
	f.transport.mockImplementation(async (input) =>
		String(input).startsWith("https://api.github.com/")
			? Response.json(f.release)
			: new Response(null, {
					status: 302,
					headers: { location: "https://evil.invalid/asset" },
				}),
	);
	try {
		await Effect.runPromise(
			Effect.gen(function* () {
				const updates = yield* AppUpdates;
				yield* updates.check();
				expect((yield* Effect.either(updates.download()))._tag).toBe("Left");
			}).pipe(Effect.provide(f.layer), Effect.scoped),
		);
		expect(f.transport).toHaveBeenCalledTimes(2);
		expect(f.restart).not.toHaveBeenCalled();
	} finally {
		await rm(f.root, { recursive: true, force: true });
	}
});
