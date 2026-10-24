import { randomBytes } from "node:crypto";
import {
	access,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Context, Effect, Either, Layer, Option, Schema } from "effect";
import type {
	ClockMediaView,
	ClockSnapshot,
} from "../../shared/clock-contracts";
import {
	ClockConfigInvalid,
	ClockMediaTooShort,
	ClockMediaUnusable,
	ClockPersistenceFailed,
} from "../../shared/clock-errors";
import {
	buildClockThemePatch,
	CLOCK_KEY_CODE,
	CLOCK_TILE_TYPE,
	type ClockAction,
	type ClockKey,
	type ClockMediaSlot,
	isClockKey,
	type MediaKind,
	MIN_VIDEO_MS,
	mediaKindOfPath,
	normalizeClockStyle,
	THEME_IDS,
	type ThemeId,
	type ThemePatchReason,
} from "../../shared/clock-style";

/**
 * `<userData>/clock-v1/clock.json`: DK-Suite's cell shape for the clock
 * profile, so profile wiring can later move these actions into the profile
 * key verbatim. Only main reads custom media paths.
 */
const ClockActionSchema = Schema.Struct({
	type: Schema.String,
	value: Schema.Unknown,
});
const ClockKeySchema = Schema.Struct({
	keyCode: Schema.String.pipe(Schema.pattern(/^\d+,\d+$/)),
	childrenName: Schema.optionalWith(Schema.String, { exact: true }),
	config: Schema.Struct({
		type: Schema.String,
		actions: Schema.Array(ClockActionSchema),
	}),
});
export const ClockRecord = Schema.Struct({
	version: Schema.Literal(1),
	revision: Schema.Int.pipe(Schema.nonNegative()),
	keys: Schema.Array(ClockKeySchema),
});
export type ClockRecord = typeof ClockRecord.Type;

/** WIDGETS-020/021: the DK-Desktop-Clock profile's single key at 1,1. */
export const defaultClockRecord: ClockRecord = {
	version: 1,
	revision: 0,
	keys: [
		{
			keyCode: CLOCK_KEY_CODE,
			childrenName: CLOCK_TILE_TYPE,
			config: {
				type: CLOCK_TILE_TYPE,
				actions: [
					{
						type: "clockStyle",
						value: {
							background: { mode: "theme", themeId: "season", themes: {} },
							// DK-Suite's first-install default; the card is open-quake-lih.7.
							musicEnabled: true,
						},
					},
					{ type: "showSeconds", value: false },
				],
			},
		},
	],
};

export class ClockRoot extends Context.Tag("ClockRoot")<ClockRoot, string>() {}

/** Main owns this decoder; management's duration is only a UI hint. */
export interface ClockVideoDecoder {
	readonly duration: (
		token: string,
	) => Effect.Effect<number, ClockMediaUnusable>;
}
export class ClockVideoProbe extends Context.Tag("ClockVideoProbe")<
	ClockVideoProbe,
	ClockVideoDecoder
>() {}

/** File IO for the store, replaceable in tests. */
export class ClockFiles extends Context.Tag("ClockFiles")<
	ClockFiles,
	{
		readonly read: (
			path: string,
		) => Effect.Effect<Option.Option<string>, ClockPersistenceFailed>;
		readonly writeAtomic: (
			path: string,
			text: string,
		) => Effect.Effect<void, ClockPersistenceFailed>;
		readonly exists: (path: string) => Effect.Effect<boolean>;
	}
>() {}

const isMissing = (cause: unknown): boolean =>
	cause instanceof Error && "code" in cause && cause.code === "ENOENT";

export const ClockFilesLive = Layer.succeed(ClockFiles, {
	read: (path) =>
		Effect.tryPromise({
			try: () => readFile(path, "utf8"),
			catch: (cause) => cause,
		}).pipe(
			Effect.map(Option.some),
			Effect.catchAll((cause) =>
				isMissing(cause)
					? Effect.succeed(Option.none<string>())
					: Effect.fail(ClockPersistenceFailed.fromCause(cause)),
			),
		),
	writeAtomic: (path, text) =>
		Effect.tryPromise({
			try: async () => {
				await mkdir(dirname(path), { recursive: true });
				const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
				try {
					await writeFile(temp, text, "utf8");
					await rename(temp, path);
				} finally {
					// Rename is the commit point. Cleanup must not turn a committed
					// save into a failure or replace the original write error.
					await rm(temp, { force: true }).catch(() => undefined);
				}
			},
			catch: (cause) => ClockPersistenceFailed.fromCause(cause),
		}),
	exists: (path) =>
		Effect.promise(() =>
			access(path).then(
				() => true,
				() => false,
			),
		),
});

export type SetThemeOutcome =
	| { readonly ok: true; readonly snapshot: ClockSnapshot }
	| { readonly ok: false; readonly reason: ThemePatchReason };

export interface MediaCandidate {
	readonly token: string;
	readonly themeId: ThemeId;
	readonly name: string;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Upserts one action on the clock key, leaving everything else untouched. */
function updateAction(
	keys: readonly ClockKey[],
	type: string,
	update: (value: unknown) => unknown,
): readonly ClockKey[] {
	const index = keys.findIndex(
		(key) => key.keyCode === CLOCK_KEY_CODE && isClockKey(key),
	);
	const fallback = defaultClockRecord.keys[0];
	const target = keys[index] ?? fallback;
	if (!target) return keys;
	const actions = target.config.actions;
	const next: readonly ClockAction[] = actions.some((a) => a.type === type)
		? actions.map((a) =>
				a.type === type ? { ...a, value: update(a.value) } : a,
			)
		: [...actions, { type, value: update(undefined) }];
	const key: ClockKey = {
		...target,
		config: { ...target.config, actions: next },
	};
	return index < 0
		? [...keys, key]
		: keys.map((k, i) => (i === index ? key : k));
}

function updateBackground(
	keys: readonly ClockKey[],
	update: (
		background: Readonly<Record<string, unknown>>,
	) => Record<string, unknown>,
): readonly ClockKey[] {
	return updateAction(keys, "clockStyle", (value) => {
		const style = isRecord(value) ? value : normalizeClockStyle(undefined);
		const background = isRecord(style.background) ? style.background : {};
		return { ...style, background: update(background) };
	});
}

/** Settles any stored background (v0.3 or v0.4) into DK's v0.4 shape. */
function v04(
	background: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
	const normalized = normalizeClockStyle({ background }).background;
	const { source: _legacy, ...rest } = background;
	return {
		...rest,
		mode: normalized.mode,
		themeId: normalized.themeId,
		themes: { ...normalized.themes },
	};
}

function withSlot(
	background: Readonly<Record<string, unknown>>,
	themeId: ThemeId,
	slot: ClockMediaSlot | null,
): Record<string, unknown> {
	const next = v04(background);
	const themes: Record<string, unknown> = isRecord(next.themes)
		? { ...next.themes }
		: {};
	if (slot) themes[themeId] = slot;
	else delete themes[themeId];
	return { ...next, themes };
}

const setThemeFailed = (reason: ThemePatchReason): SetThemeOutcome => ({
	ok: false,
	reason,
});
const setThemeSaved = (snapshot: ClockSnapshot): SetThemeOutcome => ({
	ok: true,
	snapshot,
});

export class ClockStore extends Effect.Service<ClockStore>()("ClockStore", {
	accessors: true,
	effect: Effect.gen(function* () {
		const root = yield* ClockRoot;
		const files = yield* ClockFiles;
		const videoProbe = yield* ClockVideoProbe;
		const file = join(root, "clock-v1", "clock.json");
		const lock = yield* Effect.makeSemaphore(1);
		const candidates = new Map<
			string,
			{ themeId: ThemeId; path: string; kind: MediaKind; probing: boolean }
		>();

		const load = Effect.fn("ClockStore.load")(function* () {
			const result = yield* files.read(file).pipe(Effect.either);
			if (Either.isLeft(result))
				return { record: defaultClockRecord, recovered: true };
			const text = result.right;
			if (Option.isNone(text))
				return { record: defaultClockRecord, recovered: false };
			const decoded = yield* Effect.try({
				try: (): unknown => JSON.parse(text.value),
				catch: (cause) => ClockConfigInvalid.fromCause(cause),
			}).pipe(
				Effect.flatMap((input) =>
					Schema.decodeUnknown(ClockRecord, { onExcessProperty: "preserve" })(
						input,
					).pipe(
						Effect.mapError((cause) => ClockConfigInvalid.fromCause(cause)),
					),
				),
				Effect.either,
			);
			return decoded._tag === "Right"
				? { record: decoded.right, recovered: false }
				: { record: defaultClockRecord, recovered: true };
		});

		const project = Effect.fn("ClockStore.project")(function* (
			record: ClockRecord,
			recovered: boolean,
		) {
			const key =
				record.keys.find(
					(k) => k.keyCode === CLOCK_KEY_CODE && isClockKey(k),
				) ?? defaultClockRecord.keys[0];
			const actions = key?.config.actions ?? [];
			const style = normalizeClockStyle(
				actions.find((a) => a.type === "clockStyle")?.value,
			);
			const media: Partial<Record<ThemeId, ClockMediaView>> = {};
			for (const id of THEME_IDS) {
				const slot = style.background.themes[id];
				if (!slot) continue;
				media[id] = {
					kind: slot.kind,
					name: basename(slot.path),
					url: `oq-clock-media://theme/${id}?r=${record.revision}`,
					available: yield* files.exists(slot.path),
				};
			}
			const snapshot: ClockSnapshot = {
				revision: record.revision,
				keyCode: key?.keyCode ?? CLOCK_KEY_CODE,
				mode: style.background.mode,
				themeId: style.background.themeId,
				showSeconds:
					actions.find((a) => a.type === "showSeconds")?.value === true,
				media,
				recovered,
			};
			return snapshot;
		});

		const save = (record: ClockRecord, keys: readonly ClockKey[]) => {
			const next: ClockRecord = {
				...record,
				revision: record.revision + 1,
				keys,
			};
			return files
				.writeAtomic(file, `${JSON.stringify(next, null, "\t")}\n`)
				.pipe(Effect.as(next));
		};

		const mutate = (
			update: (keys: readonly ClockKey[]) => readonly ClockKey[],
		): Effect.Effect<ClockSnapshot, ClockPersistenceFailed> =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					const { record } = yield* load();
					const keys = update(record.keys);
					if (JSON.stringify(keys) === JSON.stringify(record.keys))
						return yield* project(record, false);
					return yield* project(yield* save(record, keys), false);
				}),
			);

		const read = Effect.fn("ClockStore.read")(function* () {
			const { record, recovered } = yield* load();
			return yield* project(record, recovered);
		});

		/** DK-Suite `clock-style:set-theme`: only themeId changes, mode → theme. */
		const setTheme = Effect.fn("ClockStore.setTheme")(
			(
				keyCode: string,
				themeId: string,
			): Effect.Effect<SetThemeOutcome, ClockPersistenceFailed> =>
				lock.withPermits(1)(
					Effect.gen(function* () {
						const { record } = yield* load();
						const patch = buildClockThemePatch(record.keys, keyCode, themeId);
						if (!patch.ok) return setThemeFailed(patch.reason);
						if (!patch.changed)
							return setThemeSaved(yield* project(record, false));
						const saved = yield* save(record, patch.keys).pipe(Effect.either);
						if (Either.isLeft(saved)) return setThemeFailed("write-failed");
						return setThemeSaved(yield* project(saved.right, false));
					}),
				),
		);

		const setMode = Effect.fn("ClockStore.setMode")((mode: "none" | "theme") =>
			mutate((keys) =>
				updateBackground(keys, (background) => ({ ...v04(background), mode })),
			),
		);

		const setSeconds = Effect.fn("ClockStore.setSeconds")(
			(showSeconds: boolean) =>
				mutate((keys) => updateAction(keys, "showSeconds", () => showSeconds)),
		);

		const commitSlot = (themeId: ThemeId, slot: ClockMediaSlot | null) =>
			mutate((keys) =>
				updateBackground(keys, (background) =>
					withSlot(background, themeId, slot),
				),
			);

		/**
		 * Images are saved at once. Videos are staged until the management
		 * window has probed their duration (DK-Suite probes in its renderer too).
		 */
		const stageMedia = Effect.fn("ClockStore.stageMedia")(function* (
			themeId: ThemeId,
			path: string,
		) {
			const kind = mediaKindOfPath(path);
			if (!kind || !(yield* files.exists(path)))
				return yield* ClockMediaUnusable.fromCause(undefined);
			if (kind === "image") {
				const snapshot = yield* commitSlot(themeId, { kind, path });
				return { _tag: "saved", snapshot } as const;
			}
			const token = randomBytes(16).toString("hex");
			candidates.clear();
			candidates.set(token, { themeId, path, kind, probing: false });
			const candidate: MediaCandidate = {
				token,
				themeId,
				name: basename(path),
			};
			return { _tag: "candidate", candidate } as const;
		});

		const commitMedia = Effect.fn("ClockStore.commitMedia")(function* (
			token: string,
			_durationHintMs: number,
		) {
			const candidate = candidates.get(token);
			if (!candidate || candidate.probing)
				return yield* ClockMediaUnusable.fromCause(undefined);
			candidate.probing = true;
			const durationMs = yield* videoProbe
				.duration(token)
				.pipe(Effect.ensuring(Effect.sync(() => candidates.delete(token))));
			if (!Number.isFinite(durationMs) || durationMs <= 0)
				return yield* ClockMediaUnusable.fromCause(undefined);
			if (!(durationMs >= MIN_VIDEO_MS))
				return yield* ClockMediaTooShort.fromCause(undefined);
			return yield* commitSlot(candidate.themeId, {
				kind: candidate.kind,
				path: candidate.path,
			});
		});

		const restoreMedia = Effect.fn("ClockStore.restoreMedia")(
			(themeId: ThemeId) => commitSlot(themeId, null),
		);

		/** For the media protocol: a theme's saved file or a staged candidate. */
		const mediaPath = Effect.fn("ClockStore.mediaPath")(function* (
			target: { readonly theme: string } | { readonly candidate: string },
		) {
			if ("candidate" in target)
				return Option.fromNullable(candidates.get(target.candidate)?.path);
			const { record } = yield* load();
			const key = record.keys.find(
				(k) => k.keyCode === CLOCK_KEY_CODE && isClockKey(k),
			);
			const style = normalizeClockStyle(
				key?.config.actions.find((a) => a.type === "clockStyle")?.value,
			);
			const slot = THEME_IDS.find((id) => id === target.theme);
			return Option.fromNullable(
				slot ? style.background.themes[slot]?.path : undefined,
			);
		});

		return {
			read,
			setTheme,
			setMode,
			setSeconds,
			stageMedia,
			commitMedia,
			restoreMedia,
			mediaPath,
		};
	}),
}) {}

export const ClockLive = (
	root: string,
	decoder: ClockVideoDecoder,
): Layer.Layer<ClockStore> =>
	ClockStore.Default.pipe(
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(ClockRoot, root),
				ClockFilesLive,
				Layer.succeed(ClockVideoProbe, decoder),
			),
		),
	);
