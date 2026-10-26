import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	realpath,
	rename,
	stat,
	writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Effect, Either } from "effect";
import { newerVersion } from "../../../../../packages/edge/src/maintenance/contracts.js";
import type {
	FirmwareImage,
	FirmwareVolume,
} from "../../../../../packages/edge/src/maintenance/firmware-service.js";
import {
	FirmwareImageInvalid,
	FirmwareTargetMismatch,
	FirmwareVolumeInvalid,
	FirmwareWriteFailed,
} from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { inspectUf2 } from "../../../../../packages/protocol/src/uf2.js";

export interface TrustedFirmware {
	readonly board: "QUAKE";
	readonly sha256: string;
	readonly version: string;
	readonly start: number;
	readonly end: number;
}
// SETTINGS-047/048. This descriptor authorizes only the audited release, never arbitrary RP2040 binaries.
export const trustedFirmware: readonly TrustedFirmware[] = [
	{
		board: "QUAKE",
		sha256: "92b171021caf5ce098f31ab901c796f4facf593ea9b1d450abbbd8a16d51f874",
		version: "1.0.21",
		start: 0x12000,
		end: 0x6e7ff,
	},
];
export const hashBytes = (bytes: Uint8Array): string =>
	createHash("sha256").update(bytes).digest("hex");
export function validateFirmware(
	bytes: Uint8Array,
	name: string,
	descriptors = trustedFirmware,
): FirmwareImage {
	const inspected = inspectUf2(bytes);
	if (Either.isLeft(inspected)) throw new FirmwareImageInvalid(inspected.left);
	const fingerprint = hashBytes(bytes);
	const target = descriptors.find(
		(t) => t.sha256 === fingerprint && t.board === "QUAKE",
	);
	const info = inspected.right;
	return {
		fingerprint,
		version: target?.version ?? "",
		fileName: basename(name),
		bytes: bytes.length,
		trusted: !!target && info.start === target.start && info.end === target.end,
	};
}
interface VolumeRecord {
	readonly path: string;
	readonly device: number;
	readonly inode: number;
	readonly id: string;
	readonly label: string;
}

/** One descriptor, at most the inspected length plus one byte, even under growth. */
async function readFirmware(path: string): Promise<Buffer> {
	const file = await open(
		path,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const before = await file.stat();
		if (!before.isFile() || before.size > 16 * 1024 * 1024)
			throw new FirmwareImageInvalid();
		const bytes = Buffer.alloc(before.size + 1);
		let offset = 0;
		while (offset < bytes.length) {
			const { bytesRead } = await file.read({
				buffer: bytes,
				offset,
				length: bytes.length - offset,
				position: offset,
			});
			if (!bytesRead) break;
			offset += bytesRead;
		}
		const after = await file.stat();
		if (
			offset !== before.size ||
			after.size !== before.size ||
			after.mtimeMs !== before.mtimeMs ||
			after.ctimeMs !== before.ctimeMs
		)
			throw new FirmwareImageInvalid();
		return bytes.subarray(0, offset);
	} finally {
		await file.close();
	}
}
/** No caller supplies a destination path. Discovered identities are revalidated before exclusive copy. */
export function firmwareFiles(
	roots: readonly string[],
	descriptors = trustedFirmware,
	additional?: (fresh?: boolean) => Promise<readonly string[]>,
) {
	let imagePath = "";
	let image: FirmwareImage | undefined;
	const known = new Map<string, VolumeRecord>();
	const inspect = (
		path: string,
	): Effect.Effect<FirmwareImage, FirmwareImageInvalid> =>
		Effect.tryPromise({
			try: async () => {
				const next = validateFirmware(
					await readFirmware(path),
					path,
					descriptors,
				);
				imagePath = resolve(path);
				image = next;
				return next;
			},
			catch: (cause) =>
				cause instanceof FirmwareImageInvalid
					? cause
					: new FirmwareImageInvalid(cause),
		});
	const volumeRecord = async (
		path: string,
		fresh = false,
	): Promise<VolumeRecord> => {
		if (
			additional &&
			/^[A-Za-z]:[\\/]$/.test(path) &&
			!(await additional(fresh)).includes(path)
		)
			throw new FirmwareVolumeInvalid();
		const meta = await lstat(path);
		const actual = await realpath(path);
		if (
			!meta.isDirectory() ||
			meta.isSymbolicLink() ||
			actual !== resolve(path) ||
			(basename(path).toUpperCase() !== "QUAKE DFU" &&
				!/^[A-Za-z]:[\\/]$/.test(path))
		)
			throw new FirmwareVolumeInvalid();
		// A copied label alone is insufficient. Require bootloader metadata tied to this board.
		const markerPath = join(path, "INFO_UF2.TXT");
		const marker = await lstat(markerPath);
		if (!marker.isFile() || marker.isSymbolicLink() || marker.size > 16384)
			throw new FirmwareVolumeInvalid();
		const text = await readFile(markerPath, "utf8");
		if (!/QUAKE/i.test(text) || !/UF2|RP2040/i.test(text))
			throw new FirmwareVolumeInvalid();
		const parent = await stat(join(path, ".."));
		// Production roots are mount parents; fake roots are explicitly constructed only by tests/smoke.
		if (
			roots.some(
				(r) =>
					r === "/Volumes" ||
					r.startsWith("/media/") ||
					r.startsWith("/run/media/"),
			) &&
			parent.dev === meta.dev
		)
			throw new FirmwareVolumeInvalid();
		const id = hashBytes(Buffer.from(`${actual}\0${meta.dev}\0${meta.ino}`));
		return {
			path: actual,
			device: meta.dev,
			inode: meta.ino,
			id,
			label: `QUAKE DFU (${actual})`,
		};
	};
	return {
		inspect,
		bundled: (
			directories: readonly string[],
		): Effect.Effect<FirmwareImage | undefined, FirmwareImageInvalid> =>
			Effect.tryPromise({
				try: async () => {
					let best: { path: string; image: FirmwareImage } | undefined;
					for (const directory of directories) {
						const names = await readdir(directory).catch((cause: unknown) => {
							if (
								typeof cause === "object" &&
								cause !== null &&
								"code" in cause &&
								cause.code === "ENOENT"
							)
								return [];
							throw cause;
						});
						for (const name of names.sort()) {
							const match =
								/^QUAKE_(\d+)\.(\d+)\.(\d+)(?:_[A-Za-z0-9_-]+)?\.uf2$/i.exec(
									name,
								);
							if (!match) continue;
							const version = match.slice(1, 4).map(Number).join(".");
							if (!descriptors.some((d) => d.version === version)) continue;
							const path = join(directory, name);
							let next: FirmwareImage;
							try {
								next = validateFirmware(
									await readFirmware(path),
									name,
									descriptors,
								);
							} catch {
								continue;
							}
							if (
								next.trusted &&
								next.version === version &&
								(!best || newerVersion(next.version, best.image.version))
							)
								best = { path, image: next };
						}
					}
					if (best) {
						imagePath = resolve(best.path);
						image = best.image;
					}
					return best?.image;
				},
				catch: (cause) =>
					cause instanceof FirmwareImageInvalid
						? cause
						: new FirmwareImageInvalid(cause),
			}),
		selected: (): Effect.Effect<FirmwareImage, FirmwareTargetMismatch> =>
			image ? Effect.succeed(image) : Effect.fail(new FirmwareTargetMismatch()),
		discover: (): Effect.Effect<
			readonly FirmwareVolume[],
			FirmwareVolumeInvalid
		> =>
			Effect.tryPromise({
				try: async () => {
					const found: FirmwareVolume[] = [];
					for (const path of additional
						? await additional().catch(() => [])
						: []) {
						const record = await volumeRecord(path).catch(() => undefined);
						if (record) {
							known.set(record.id, record);
							found.push({ id: record.id, label: record.label });
						}
					}
					for (const root of roots) {
						const names = await readdir(root).catch(() => []);
						for (const name of names)
							if (name.toUpperCase() === "QUAKE DFU") {
								const record = await volumeRecord(join(root, name)).catch(
									() => undefined,
								);
								if (record) {
									known.set(record.id, record);
									found.push({ id: record.id, label: record.label });
								}
							}
					}
					return found;
				},
				catch: (cause) => new FirmwareVolumeInvalid(cause),
			}),
		pathFor: (id: string): string | undefined => known.get(id)?.path,
		copy: (
			selected: FirmwareImage,
			volume: FirmwareVolume,
			progress: (n: number) => void,
		): Effect.Effect<
			void,
			FirmwareWriteFailed | FirmwareVolumeInvalid | FirmwareTargetMismatch
		> =>
			Effect.tryPromise({
				try: async () => {
					const record = known.get(volume.id);
					if (!record) throw new FirmwareVolumeInvalid();
					const live = await volumeRecord(record.path, true);
					if (
						live.id !== record.id ||
						live.device !== record.device ||
						live.inode !== record.inode
					)
						throw new FirmwareVolumeInvalid();
					const bytes = await readFirmware(imagePath);
					const checked = validateFirmware(
						bytes,
						selected.fileName,
						descriptors,
					);
					if (!checked.trusted || checked.fingerprint !== selected.fingerprint)
						throw new FirmwareTargetMismatch();
					const destination = join(record.path, "open-quake-update.uf2");
					// O_EXCL/O_NOFOLLOW refuses overwrite and symlink targets. Never retry a partial flash.
					const output = await open(
						destination,
						constants.O_WRONLY |
							constants.O_CREAT |
							constants.O_EXCL |
							constants.O_NOFOLLOW,
						0o600,
					);
					try {
						const opened = await output.stat();
						const parent = await lstat(record.path);
						const target = await lstat(destination);
						if (
							!opened.isFile() ||
							opened.dev !== record.device ||
							!parent.isDirectory() ||
							parent.isSymbolicLink() ||
							parent.dev !== record.device ||
							parent.ino !== record.inode ||
							target.isSymbolicLink() ||
							target.dev !== opened.dev ||
							target.ino !== opened.ino ||
							(await realpath(destination)) !== destination ||
							(await realpath(record.path)) !== record.path
						)
							throw new FirmwareVolumeInvalid();
						// Node has no openat/unlinkat. Keep rejected creations empty rather than
						// unlinking a pathname that could now identify somebody else's file.
						let offset = 0;
						while (offset < bytes.length) {
							const result = await output.write(
								bytes,
								offset,
								Math.min(65536, bytes.length - offset),
								offset,
							);
							if (!result.bytesWritten) throw new FirmwareWriteFailed();
							offset += result.bytesWritten;
							progress(offset);
						}
						await output.sync();
						const written = await output.stat();
						if (written.size !== bytes.length) throw new FirmwareWriteFailed();
					} finally {
						await output.close();
					}
				},
				catch: (cause) =>
					cause instanceof FirmwareVolumeInvalid ||
					cause instanceof FirmwareTargetMismatch
						? cause
						: new FirmwareWriteFailed(cause),
			}),
	};
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
	await mkdir(resolve(path, ".."), { recursive: true });
	const temporary = `${path}.pending`;
	await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
	await rename(temporary, path);
}
