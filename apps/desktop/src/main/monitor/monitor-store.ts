import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Either, type Layer, Schema } from "effect";
import {
	defaults,
	type MediaSlot,
	type MediaView,
	MonitorRecord,
	MonitorSettings,
	type SettingsView,
	STYLES,
	type StyleId,
} from "../../shared/monitor-contracts";
import {
	MonitorConfigInvalid,
	MonitorMediaUnusable,
	MonitorPersistenceFailed,
} from "../../shared/monitor-errors";

export interface SelectedMedia {
	readonly kind: "image" | "video";
	readonly name: string;
	readonly bytes: Uint8Array;
	readonly mime: string;
}
export interface MonitorStorage {
	readonly load: () => Promise<unknown>;
	readonly save: (value: MonitorRecord) => Promise<void>;
	readonly putMedia: (id: string, media: SelectedMedia) => Promise<void>;
	readonly getMedia: (
		slot: MediaSlot,
	) => Promise<{ bytes: Uint8Array; mime: string }>;
}
const dataUrl = (media: { bytes: Uint8Array; mime: string }): string =>
	`data:${media.mime};base64,${Buffer.from(media.bytes).toString("base64")}`;
export class MonitorStore extends Effect.Service<MonitorStore>()(
	"MonitorStore",
	{
		accessors: true,
		effect: (storage: MonitorStorage) =>
			Effect.gen(function* () {
				const loaded = yield* Effect.promise(() => storage.load());
				const decoded = Schema.decodeUnknownEither(MonitorRecord)(loaded);
				let record: MonitorRecord = Either.isRight(decoded)
					? decoded.right
					: { revision: 0, settings: defaults() };
				let recovered = loaded !== undefined && Either.isLeft(decoded);
				const staged = new Map<string, MediaSlot>();
				const lock = yield* Effect.makeSemaphore(1);
				const mediaView = (slot: MediaSlot): Effect.Effect<MediaView> =>
					Effect.tryPromise({
						try: () => storage.getMedia(slot),
						catch: (cause) => new MonitorMediaUnusable(cause),
					}).pipe(
						Effect.map((media) => ({
							kind: slot.kind,
							url: dataUrl(media),
							available: true,
						})),
						Effect.catchTag("MonitorMediaUnusable", () =>
							Effect.succeed({ kind: slot.kind, url: "", available: false }),
						),
					);
				const read = Effect.fn("MonitorStore.read")(function* (
					styleId?: StyleId,
				): Effect.fn.Return<SettingsView> {
					const current = record;
					const media: Partial<Record<StyleId, MediaView>> = {};
					const style =
						styleId ??
						(current.settings.background === "custom"
							? current.settings.styleId
							: undefined);
					const slot = style && current.settings.media[style];
					if (style && slot) media[style] = yield* mediaView(slot);
					return { ...current, media, recovered };
				});
				return {
					read,
					configuration: Effect.fn("MonitorStore.configuration")(
						(): Effect.Effect<MonitorRecord> => Effect.sync(() => record),
					),
					save: Effect.fn("MonitorStore.save")(function* (
						revision: number,
						input: MonitorSettings,
					): Effect.fn.Return<
						SettingsView,
						MonitorConfigInvalid | MonitorPersistenceFailed
					> {
						return yield* lock.withPermits(1)(
							Effect.gen(function* () {
								const decoded =
									Schema.decodeUnknownEither(MonitorSettings)(input);
								if (Either.isLeft(decoded) || record.revision !== revision)
									return yield* Effect.fail(new MonitorConfigInvalid());
								const settings = decoded.right;
								for (const style of STYLES) {
									const slot = settings.media[style];
									const known =
										slot &&
										(staged.get(slot.id) ?? record.settings.media[style]);
									if (
										slot &&
										(!known ||
											slot.id !== known.id ||
											slot.kind !== known.kind ||
											slot.name !== known.name)
									)
										return yield* Effect.fail(new MonitorConfigInvalid());
								}
								const next = { revision: revision + 1, settings };
								yield* Effect.tryPromise({
									try: () => storage.save(next),
									catch: (cause) => new MonitorPersistenceFailed(cause),
								});
								record = next;
								recovered = false;
								return yield* read();
							}),
						);
					}),
					stage: Effect.fn("MonitorStore.stage")(function* (
						media: SelectedMedia,
					): Effect.fn.Return<
						{ slot: MediaSlot; view: MediaView },
						MonitorMediaUnusable
					> {
						const slot = {
							id: randomBytes(16).toString("hex"),
							kind: media.kind,
							name: media.name,
						};
						yield* Effect.tryPromise({
							try: () => storage.putMedia(slot.id, media),
							catch: (cause) => new MonitorMediaUnusable(cause),
						});
						staged.set(slot.id, slot);
						return {
							slot,
							view: { kind: media.kind, url: dataUrl(media), available: true },
						};
					}),
				};
			}),
	},
) {}
export const monitorStorage = (root: string): MonitorStorage => {
	const base = join(root, "monitor-v1"),
		path = join(base, "settings.json");
	return {
		load: async () => {
			try {
				return JSON.parse(await readFile(path, "utf8"));
			} catch (cause) {
				if (
					cause instanceof Error &&
					"code" in cause &&
					cause.code === "ENOENT"
				)
					return undefined;
				return null;
			}
		},
		save: async (value) => {
			await mkdir(base, { recursive: true });
			const staged = `${path}.new`;
			await writeFile(staged, JSON.stringify(value), { mode: 0o600 });
			await rename(staged, path);
		},
		putMedia: async (id, media) => {
			await mkdir(join(base, "assets"), { recursive: true });
			await writeFile(join(base, "assets", id), media.bytes, { mode: 0o600 });
			await writeFile(join(base, "assets", `${id}.mime`), media.mime, {
				mode: 0o600,
			});
		},
		getMedia: async (slot) => ({
			bytes: await readFile(join(base, "assets", slot.id)),
			mime: await readFile(join(base, "assets", `${slot.id}.mime`), "utf8"),
		}),
	};
};
export const monitorStoreLive = (root: string): Layer.Layer<MonitorStore> =>
	MonitorStore.Default(monitorStorage(root));
