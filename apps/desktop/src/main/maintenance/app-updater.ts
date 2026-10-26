import { createHash, verify } from "node:crypto";
import { constants } from "node:fs";
import {
	type FileHandle,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readdir,
	rm,
	unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { Version } from "../../../../../packages/edge/src/maintenance/contracts.js";
import { AppUpdateFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import type {
	AppRelease,
	AppUpdatePort,
} from "../../../../../packages/edge/src/maintenance/update-service.js";

const Release = Schema.Struct({
	app: Schema.Literal("open-quake"),
	version: Version,
	platform: Schema.String,
	arch: Schema.String,
	sha256: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
	bytes: Schema.Int.pipe(Schema.between(1, 256 * 1024 * 1024)),
	artifact: Schema.String,
});
const Envelope = Schema.Struct({
	payload: Schema.String.pipe(Schema.maxLength(32768)),
	signature: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9+/]{86}==$/)),
});
/** The installer consumes verified bytes from a pinned descriptor, never a replaceable path.
 * It must finish consuming the artifact before its promise resolves. */
export interface VerifiedUpdateArtifact {
	readonly read: (buffer: Uint8Array, position: number) => Promise<number>;
}
export interface OwnedUpdateConfiguration {
	readonly feed: string;
	readonly artifactOrigin: string;
	/** PEM Ed25519 key pinned by the distributor, never supplied by release metadata. */
	readonly publicKey: string;
	/** The distributor must choose an installer policy before enabling this adapter. */
	readonly install: (
		artifact: VerifiedUpdateArtifact,
		release: AppRelease,
	) => Promise<void>;
	readonly fetch?: typeof fetch;
}
function trustedUrl(raw: string, origin?: string): URL {
	const url = new URL(raw);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.hash ||
		(origin && url.origin !== origin)
	)
		throw new AppUpdateFailed();
	return url;
}
const chunkSize = 65536;
async function* responseChunks(response: Response, limit: number) {
	if (!response.ok || !response.body) throw new AppUpdateFailed();
	const announced = response.headers.get("content-length");
	if (announced && (!/^\d+$/.test(announced) || Number(announced) > limit))
		throw new AppUpdateFailed();
	const reader = response.body.getReader();
	let bytes = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			bytes += next.value.length;
			if (bytes > limit) throw new AppUpdateFailed();
			yield next.value;
		}
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
}
/** Only the tiny signed metadata envelope is collected in memory. */
async function boundedResponse(
	response: Response,
	limit: number,
): Promise<Buffer> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of responseChunks(response, limit)) chunks.push(chunk);
	return Buffer.concat(chunks);
}
async function verifyFile(file: FileHandle, release: AppRelease) {
	const before = await file.stat();
	if (!before.isFile() || before.size !== release.bytes)
		throw new AppUpdateFailed();
	const buffer = Buffer.alloc(chunkSize);
	const hash = createHash("sha256");
	let offset = 0;
	while (true) {
		const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
		if (!bytesRead) break;
		offset += bytesRead;
		if (offset > release.bytes) throw new AppUpdateFailed();
		hash.update(buffer.subarray(0, bytesRead));
	}
	const after = await file.stat();
	if (
		offset !== release.bytes ||
		hash.digest("hex") !== release.sha256 ||
		after.size !== before.size ||
		after.mtimeMs !== before.mtimeMs ||
		after.ctimeMs !== before.ctimeMs
	)
		throw new AppUpdateFailed();
	return after;
}
/** No default endpoint or installer. An unconfigured build makes zero network requests. */
export function ownedAppUpdater(options: {
	readonly root: string;
	readonly currentVersion: string;
	readonly platform: string;
	readonly arch: string;
	readonly configuration?: OwnedUpdateConfiguration;
}): typeof AppUpdatePort.Service {
	const config = options.configuration;
	const transport = config?.fetch ?? fetch;
	let selected: AppRelease | undefined;
	let downloaded: string | undefined;
	const pathFor = (release: AppRelease) =>
		join(options.root, `app-update-${release.sha256}.artifact`);
	const prune = async (current: AppRelease) => {
		for (const entry of await readdir(options.root, { withFileTypes: true })) {
			if (
				entry.isFile() &&
				/^app-update-[a-f0-9]{64}\.artifact$/.test(entry.name) &&
				join(options.root, entry.name) !== pathFor(current)
			)
				await unlink(join(options.root, entry.name));
		}
	};
	const boundary = <A>(run: (signal: AbortSignal) => Promise<A>) =>
		Effect.tryPromise({
			try: run,
			catch: (cause) =>
				cause instanceof AppUpdateFailed ? cause : new AppUpdateFailed(cause),
		});
	const checked = async (release: AppRelease) => {
		if (
			!selected ||
			JSON.stringify(release) !== JSON.stringify(selected) ||
			downloaded !== pathFor(release)
		)
			throw new AppUpdateFailed();
		const file = await open(
			downloaded,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		try {
			const metadata = await verifyFile(file, release);
			const named = await lstat(downloaded);
			if (named.ino !== metadata.ino || named.dev !== metadata.dev)
				throw new AppUpdateFailed();
			return metadata;
		} finally {
			await file.close();
		}
	};
	return {
		enabled: !!config,
		currentVersion: options.currentVersion,
		platform: options.platform,
		arch: options.arch,
		check: () =>
			boundary(async (signal) => {
				if (!config) return Option.none();
				selected = undefined;
				downloaded = undefined;
				const url = trustedUrl(config.feed);
				const origin = trustedUrl(config.artifactOrigin).origin;
				const response = await transport(url.href, {
					signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
					redirect: "error",
					credentials: "omit",
				});
				if (response.url && response.url !== url.href)
					throw new AppUpdateFailed();
				const envelope = Schema.decodeUnknownSync(Envelope)(
					JSON.parse((await boundedResponse(response, 65536)).toString("utf8")),
				);
				if (
					!verify(
						null,
						Buffer.from(envelope.payload),
						config.publicKey,
						Buffer.from(envelope.signature, "base64"),
					)
				)
					throw new AppUpdateFailed();
				const release = Schema.decodeUnknownSync(Release)(
					JSON.parse(envelope.payload),
				);
				trustedUrl(release.artifact, origin);
				if (
					release.platform !== options.platform ||
					release.arch !== options.arch
				)
					throw new AppUpdateFailed();
				selected = release;
				return Option.some(release);
			}),
		download: (release, progress) =>
			boundary(async (signal) => {
				if (
					!config ||
					!selected ||
					JSON.stringify(release) !== JSON.stringify(selected)
				)
					throw new AppUpdateFailed();
				downloaded = undefined;
				const url = trustedUrl(
					release.artifact,
					trustedUrl(config.artifactOrigin).origin,
				);
				const response = await transport(url.href, {
					signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
					redirect: "error",
					credentials: "omit",
				});
				if (response.url && response.url !== url.href)
					throw new AppUpdateFailed();
				await mkdir(options.root, { recursive: true });
				const path = pathFor(release);
				// Only this adapter owns this deterministic cache name. Never accept arbitrary renderer paths.
				try {
					await unlink(path);
				} catch (cause) {
					if (
						typeof cause !== "object" ||
						cause === null ||
						!("code" in cause) ||
						cause.code !== "ENOENT"
					)
						throw cause;
				}
				const file = await open(
					path,
					constants.O_WRONLY |
						constants.O_CREAT |
						constants.O_EXCL |
						constants.O_NOFOLLOW,
					0o600,
				);
				try {
					const hash = createHash("sha256");
					let bytes = 0;
					for await (const chunk of responseChunks(response, release.bytes)) {
						await file.writeFile(chunk);
						hash.update(chunk);
						bytes += chunk.length;
						progress(bytes / release.bytes);
					}
					if (bytes !== release.bytes || hash.digest("hex") !== release.sha256)
						throw new AppUpdateFailed();
					await file.sync();
				} finally {
					await file.close();
				}
				downloaded = path;
				await checked(release);
				await prune(release);
				progress(1);
			}),
		install: (release) =>
			boundary(async () => {
				if (!config) throw new AppUpdateFailed();
				const verified = await checked(release);
				const directory = await mkdtemp(
					join(options.root, ".app-update-install-"),
				);
				try {
					const source = await open(
						pathFor(release),
						constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
					);
					const path = join(directory, "artifact");
					try {
						const current = await source.stat();
						if (
							current.ino !== verified.ino ||
							current.dev !== verified.dev ||
							current.size !== verified.size ||
							current.mtimeMs !== verified.mtimeMs ||
							current.ctimeMs !== verified.ctimeMs
						)
							throw new AppUpdateFailed();
						const output = await open(
							path,
							constants.O_WRONLY |
								constants.O_CREAT |
								constants.O_EXCL |
								constants.O_NOFOLLOW,
							0o600,
						);
						try {
							const buffer = Buffer.alloc(chunkSize);
							let offset = 0;
							while (offset < release.bytes) {
								const { bytesRead } = await source.read(
									buffer,
									0,
									Math.min(buffer.length, release.bytes - offset),
									offset,
								);
								if (!bytesRead) throw new AppUpdateFailed();
								await output.writeFile(buffer.subarray(0, bytesRead));
								offset += bytesRead;
							}
							await output.sync();
							await output.chmod(0o400);
						} finally {
							await output.close();
						}
					} finally {
						await source.close();
					}
					const input = await open(
						path,
						constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
					);
					try {
						// Remove the copy's name before its final hash, retaining only a read descriptor.
						await unlink(path);
						await verifyFile(input, release);
						const final = await checked(release);
						if (
							final.ino !== verified.ino ||
							final.dev !== verified.dev ||
							final.mtimeMs !== verified.mtimeMs ||
							final.ctimeMs !== verified.ctimeMs
						)
							throw new AppUpdateFailed();
						await config.install(
							{
								read: async (buffer, position) =>
									(await input.read(buffer, 0, buffer.length, position))
										.bytesRead,
							},
							release,
						);
					} finally {
						await input.close();
					}
				} finally {
					await rm(directory, { recursive: true, force: true });
				}
				await prune(release);
			}),
	};
}
