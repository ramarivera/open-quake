import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Schema } from "effect";
import { AppUpdateFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors";
import type {
	OwnedUpdateConfiguration,
	VerifiedUpdateArtifact,
} from "./app-updater";

export const RELEASES_PAGE =
	"https://github.com/ramarivera/open-quake/releases";
const API =
	"https://api.github.com/repos/ramarivera/open-quake/releases/latest";
const Release = Schema.Struct({
	tag_name: Schema.String,
	draft: Schema.Boolean,
	prerelease: Schema.Boolean,
	assets: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			size: Schema.Number,
			digest: Schema.NullOr(Schema.String),
			browser_download_url: Schema.String,
		}),
	),
});
/** GitHub supplies the publisher's asset digest. Trust stays pinned to this repository over HTTPS. */
export function githubAppImageConfiguration(options: {
	readonly arch: string;
	readonly image: string;
	readonly fetch?: typeof fetch;
	readonly restart: () => void;
}): OwnedUpdateConfiguration {
	const transport = options.fetch ?? fetch;
	return {
		artifactOrigin: "https://github.com",
		resolveRelease: async (signal) => {
			const response = await transport(API, {
				signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
				redirect: "error",
				credentials: "omit",
				headers: { Accept: "application/vnd.github+json" },
			});
			if (response.status === 404) return undefined;
			if (!response.ok || (response.url && response.url !== API))
				throw new AppUpdateFailed();
			if (Number(response.headers.get("content-length")) > 1024 * 1024)
				throw new AppUpdateFailed();
			if (!response.body) throw new AppUpdateFailed();
			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let bytes = 0;
			try {
				while (true) {
					const next = await reader.read();
					if (next.done) break;
					bytes += next.value.length;
					if (bytes > 1024 * 1024) throw new AppUpdateFailed();
					chunks.push(next.value);
				}
			} finally {
				await reader.cancel();
				reader.releaseLock();
			}
			const release = Schema.decodeUnknownSync(Release)(
				JSON.parse(Buffer.concat(chunks).toString("utf8")),
			);
			if (release.draft || release.prerelease) return undefined;
			const version = release.tag_name.replace(/^v/, "");
			const name = `open-quake-${version}-linux-${options.arch}.AppImage`;
			const asset = release.assets.find((candidate) => candidate.name === name);
			if (!asset) return undefined;
			const url = new URL(asset.browser_download_url);
			if (
				url.href !== `${RELEASES_PAGE}/download/${release.tag_name}/${name}` ||
				!asset.digest?.match(/^sha256:[a-f0-9]{64}$/)
			)
				throw new AppUpdateFailed();
			return {
				app: "open-quake",
				version,
				platform: "linux",
				arch: options.arch,
				artifact: url.href,
				sha256: asset.digest.slice(7),
				bytes: asset.size,
			};
		},
		fetch: async (input, init) => {
			let url = new URL(String(input));
			// GitHub redirects release assets to its own blob host. Never carry credentials.
			for (let hop = 0; hop < 4; hop++) {
				if (
					url.protocol !== "https:" ||
					url.username ||
					url.password ||
					url.hash ||
					![
						"github.com",
						"release-assets.githubusercontent.com",
						"objects.githubusercontent.com",
					].includes(url.hostname)
				)
					throw new AppUpdateFailed();
				const response = await transport(url.href, {
					...init,
					redirect: "manual",
					credentials: "omit",
				});
				if ([301, 302, 303, 307, 308].includes(response.status)) {
					const next = response.headers.get("location");
					await response.body?.cancel();
					if (!next) throw new AppUpdateFailed();
					url = new URL(next, url);
					continue;
				}
				// The pinned downloader checks its requested URL; redirects were validated above.
				return new Response(response.body, {
					status: response.status,
					headers: response.headers,
				});
			}
			throw new AppUpdateFailed();
		},
		install: async (artifact) => {
			await replaceAppImage(options.image, artifact);
			options.restart();
		},
	};
}
/** Atomic same-directory replacement. Never follow a changed destination or write the mounted image. */
export async function replaceAppImage(
	image: string,
	artifact: VerifiedUpdateArtifact,
): Promise<void> {
	if (
		!image.startsWith("/") ||
		!image.endsWith(".AppImage") ||
		(await realpath(image)) !== image
	)
		throw new AppUpdateFailed();
	const before = await lstat(image);
	if (!before.isFile() || !(before.mode & 0o111)) throw new AppUpdateFailed();
	const path = join(
		dirname(image),
		`.open-quake-update-${randomUUID()}.AppImage`,
	);
	const output = await open(
		path,
		constants.O_WRONLY |
			constants.O_CREAT |
			constants.O_EXCL |
			constants.O_NOFOLLOW,
		0o700,
	);
	try {
		const buffer = Buffer.alloc(65536);
		let offset = 0;
		while (true) {
			const length = await artifact.read(buffer, offset);
			if (!length) break;
			await output.writeFile(buffer.subarray(0, length));
			offset += length;
		}
		await output.chmod(before.mode & 0o777);
		await output.sync();
		const current = await lstat(image);
		if (
			current.ino !== before.ino ||
			current.dev !== before.dev ||
			current.mtimeMs !== before.mtimeMs ||
			current.size !== before.size
		)
			throw new AppUpdateFailed();
		await rename(path, image);
	} finally {
		await output.close();
		await unlink(path).catch((cause: unknown) => {
			if (
				!(
					typeof cause === "object" &&
					cause !== null &&
					"code" in cause &&
					cause.code === "ENOENT"
				)
			)
				throw cause;
		});
	}
}
