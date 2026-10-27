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

const {
	downloadName,
}: {
	downloadName: (
		version: string,
		platform: string,
		arch: string,
		extension: string,
	) => string;
} = await import(new URL("../../../scripts/release.mjs", import.meta.url).href);

async function fixture(
	overrides: Record<string, unknown> = {},
	arch: "x64" | "arm64" = "arm64",
) {
	const root = await mkdtemp(join(tmpdir(), "github-update-"));
	const image = join(root, "open-quake.AppImage");
	await writeFile(image, "old synthetic image");
	await chmod(image, 0o755);
	const bytes = Buffer.from("new synthetic image, never executed");
	const digest = createHash("sha256").update(bytes).digest("hex");
	const name =
		arch === "x64"
			? "open-quake-1.1.0-linux-x86_64.AppImage"
			: "open-quake-1.1.0-linux-arm64.AppImage";
	const url = `${RELEASES_PAGE}/download/v1.1.0/${name}`;
	const release = {
		tag_name: "v1.1.0",
		draft: false,
		prerelease: false,
		assets: [
			{
				name,
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
		arch,
		image,
		fetch: transport,
		restart,
	});
	const port = ownedAppUpdater({
		root: join(root, "updates"),
		platform: "linux",
		arch,
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
it.each(["x64", "arm64"] as const)(
	"MAIN-114 real update service downloads the published %s AppImage, verifies it and waits for explicit install",
	async (arch) => {
		const f = await fixture({}, arch);
		const download = vi.spyOn(f.port, "download");
		try {
			expect(f.release.assets[0]?.name).toBe(
				downloadName("1.1.0", "linux", arch, "AppImage"),
			);
			await Effect.runPromise(
				Effect.gen(function* () {
					const updates = yield* AppUpdates;
					yield* updates.check();
					expect(yield* updates.snapshot()).toMatchObject({
						state: "available",
						version: "1.1.0",
					});
					yield* updates.download();
					expect(download).toHaveBeenCalledWith(
						expect.objectContaining({
							arch,
							artifact: f.release.assets[0]?.browser_download_url,
						}),
						expect.any(Function),
					);
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
			expect(f.transport.mock.calls.map(([input]) => String(input))).toEqual([
				"https://api.github.com/repos/ramarivera/open-quake/releases/latest",
				f.release.assets[0]?.browser_download_url,
				"https://release-assets.githubusercontent.com/owned/test",
			]);
		} finally {
			await rm(f.root, { recursive: true, force: true });
		}
	},
);
it.each([
	{ digest: null },
	{
		browser_download_url:
			"https://github.com/foreign/app/releases/download/v1.1.0/app.AppImage",
	},
	{ digest: `sha256:${"0".repeat(64)}` },
	{ size: 2 },
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

it.each([
	[
		"https://github.com/foreign/repository/releases/download/v1/same.AppImage",
		false,
	],
	[
		"https://release-assets.githubusercontent.com/github-production-release-asset/123/blob?signature=test",
		false,
	],
	[
		"https://objects.githubusercontent.com/github-production-release-asset/123/blob?signature=test",
		false,
	],
	[
		"https://github.com/foreign/repository/releases/download/v1/untrusted.AppImage",
		true,
	],
	["https://release-assets.githubusercontent.com/foreign/blob", true],
	["https://release-assets.githubusercontent.com:8443/asset", false],
])(
	"MAIN-114 validates pinned digest and size after redirect to %s",
	async (destination, malicious) => {
		const f = await fixture();
		const body = malicious ? Buffer.alloc(f.bytes.length, 120) : f.bytes;
		f.transport.mockImplementation(async (input) => {
			const url = String(input);
			if (url.startsWith("https://api.github.com/"))
				return Response.json(f.release);
			if (url === f.release.assets[0]?.browser_download_url)
				return new Response(null, {
					status: 302,
					headers: { location: destination },
				});
			return new Response(body);
		});
		try {
			const allowed = !malicious && !destination.includes(":8443");
			await Effect.runPromise(
				Effect.gen(function* () {
					const updates = yield* AppUpdates;
					yield* updates.check();
					const result = yield* Effect.either(updates.download());
					expect(result._tag).toBe(allowed ? "Right" : "Left");
					if (allowed) yield* updates.install();
					else expect((yield* updates.snapshot()).state).not.toBe("ready");
				}).pipe(Effect.provide(f.layer), Effect.scoped),
			);
			expect(await readFile(f.image)).toEqual(
				allowed ? f.bytes : Buffer.from("old synthetic image"),
			);
			expect(f.restart).toHaveBeenCalledTimes(allowed ? 1 : 0);
			for (const [, init] of f.transport.mock.calls)
				expect(init?.credentials).toBe("omit");
			if (destination.includes(":8443"))
				expect(f.transport).toHaveBeenCalledTimes(2);
		} finally {
			await rm(f.root, { recursive: true, force: true });
		}
	},
);
