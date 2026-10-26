import { Clock, Effect, type Scope } from "effect";
import type { Display } from "electron";
import { resolveAppLocale } from "../../../../../packages/edge/src/settings/settings-invariants";
import type { NativeDisplayEvidence } from "../../shared/lifecycle-contracts";
import strings from "../../shared/lifecycle-strings.json";
import { DisplayOperationFailed, farRightOrigins } from "./native-display";

const LATER_MS = 600_000;

export interface PromptRequest {
	readonly title: string;
	readonly message: string;
	readonly detail: string;
	readonly buttons: string[];
	readonly defaultId: number;
	readonly cancelId: number;
}
export interface PromptEdges {
	readonly windowsProbe?: () => Effect.Effect<
		NativeDisplayEvidence,
		DisplayOperationFailed
	>;
	readonly windowsExtend?: () => Effect.Effect<void, DisplayOperationFailed>;
	readonly arrangement?: {
		read: () => Effect.Effect<boolean, DisplayOperationFailed>;
		save: () => Effect.Effect<void, DisplayOperationFailed>;
	};
	readonly hiddenMirroring?: () => Effect.Effect<
		boolean,
		DisplayOperationFailed
	>;
	readonly locale?: () => string;
	readonly platform: string;
	readonly mock: boolean;
	readonly displays: () => readonly Display[];
	readonly primaryId: () => number;
	readonly prompt: (
		request: PromptRequest,
	) => Effect.Effect<number, DisplayOperationFailed>;
	readonly openSettings: () => Effect.Effect<void, DisplayOperationFailed>;
	readonly disconnect?: () => Effect.Effect<void>;
	readonly native: (
		action: "probe" | "fix",
		display: Display,
	) => Effect.Effect<string, DisplayOperationFailed>;
}
export const makeDisplayPrompts = Effect.fn("DisplayPrompts.make")(function* (
	edges: PromptEdges,
): Effect.fn.Return<
	{
		check: (
			display: Display | undefined,
			locked: boolean,
			wizardOpen?: boolean,
		) => Effect.Effect<boolean, DisplayOperationFailed>;
		prepareWindows: () => Effect.Effect<boolean, DisplayOperationFailed>;
		repair: (
			display: Display | undefined,
		) => Effect.Effect<boolean, DisplayOperationFailed>;
	},
	never,
	Scope.Scope
> {
	let verticalSince: number | undefined;
	let landscapeAt = Number.NEGATIVE_INFINITY;
	let orientationShown = false;
	let busy = false;
	let orientationLater = 0;
	let layoutLater = 0;
	let hiddenProbeAfter = 0;
	let seedLoaded = false;
	let seeded = false;
	const loadSeed = Effect.gen(function* () {
		if (!seedLoaded) {
			seeded = yield* edges.arrangement?.read() ?? Effect.succeed(false);
			seedLoaded = true;
		}
	});
	const copy = () =>
		strings.locales[resolveAppLocale(edges.locale?.() ?? "en")].displayMode;
	const mirrorDetail = (text: ReturnType<typeof copy>) =>
		`${text.message}. ${text.laterDetail}`;
	const repair = Effect.fn("DisplayPrompts.repair")(function* (
		display: Display | undefined,
		mirrored = false,
	): Effect.fn.Return<boolean, DisplayOperationFailed> {
		if (edges.platform === "win32") return yield* prepareWindows();
		if (!display || edges.mock || edges.platform !== "darwin" || busy)
			return false;
		busy = true;
		const text = copy();
		return yield* Effect.gen(function* () {
			yield* loadSeed;
			const response = yield* edges.prompt({
				title: text.title,
				message: mirrored ? text.message : text.farRight,
				detail: `${mirrored ? mirrorDetail(text) : ""}\n\n${text.placementDetail}`,
				buttons: [
					text.switch,
					text.orientationLater,
					...(mirrored && edges.disconnect ? [text.disconnect] : []),
				],
				defaultId: 1,
				cancelId: 1,
			});
			if (response === 0) {
				const result = yield* edges.native("fix", display);
				if (result !== "applied")
					return yield* Effect.fail(
						new DisplayOperationFailed({ operation: "arrangement-result" }),
					);
				if (!seeded && edges.arrangement) {
					yield* edges.arrangement.save();
					seeded = true;
				}
			} else {
				layoutLater = (yield* Clock.currentTimeMillis) + LATER_MS;
				if (response === 2 && mirrored)
					yield* edges.disconnect?.() ?? Effect.void;
			}
			return response === 0;
		}).pipe(
			Effect.tapError(() =>
				Clock.currentTimeMillis.pipe(
					Effect.tap((now) =>
						Effect.sync(() => {
							layoutLater = now + LATER_MS;
						}),
					),
				),
			),
			Effect.ensuring(
				Effect.sync(() => {
					busy = false;
				}),
			),
		);
	});
	const check = Effect.fn("DisplayPrompts.check")(function* (
		display: Display | undefined,
		locked: boolean,
		wizardOpen = false,
	): Effect.fn.Return<boolean, DisplayOperationFailed> {
		if (locked || wizardOpen || edges.mock || busy) return false;
		const now = yield* Clock.currentTimeMillis;
		const text = copy();
		if (!display) {
			if (
				edges.platform !== "darwin" ||
				!edges.hiddenMirroring ||
				now < layoutLater ||
				now < hiddenProbeAfter
			)
				return false;
			hiddenProbeAfter = now + 10_000;
			if (!(yield* edges.hiddenMirroring())) return false;
			busy = true;
			yield* edges
				.prompt({
					title: text.title,
					message: text.message,
					detail: mirrorDetail(text),
					buttons: [
						text.openDisplaySettings,
						text.orientationLater,
						...(edges.disconnect ? [text.disconnect] : []),
					],
					defaultId: 1,
					cancelId: 1,
				})
				.pipe(
					Effect.flatMap((response) =>
						response === 0
							? edges.openSettings()
							: response === 2
								? (edges.disconnect?.() ?? Effect.void)
								: Effect.void,
					),
					Effect.ensuring(
						Effect.sync(() => {
							busy = false;
							layoutLater = now + LATER_MS;
						}),
					),
				);
			return false;
		}
		if (edges.platform === "darwin" && now >= layoutLater) {
			yield* loadSeed;
			const mode = yield* edges.native("probe", display).pipe(Effect.either);
			const origins = farRightOrigins(
				edges.displays(),
				display,
				edges.primaryId(),
			);
			const target = origins.find((origin) => origin.id === display.id);
			if (
				(mode._tag === "Right" && mode.right === "mirrored") ||
				(target &&
					(display.bounds.x !== target.x ||
						display.bounds.y !== target.y ||
						display.id === edges.primaryId()))
			) {
				const fixed = yield* repair(
					display,
					mode._tag === "Right" && mode.right === "mirrored",
				);
				if (!fixed && mode._tag === "Left") return yield* mode.left;
				return fixed;
			}
			if (mode._tag === "Left") return yield* mode.left;
		}
		if (display.size.height <= display.size.width) {
			verticalSince = undefined;
			landscapeAt = now;
			orientationShown = false;
			return false;
		}
		if (now - landscapeAt < 6000) return false;
		verticalSince ??= now;
		if (
			now - verticalSince < 2500 ||
			orientationShown ||
			now < orientationLater
		)
			return false;
		busy = true;
		const detail =
			edges.platform === "darwin"
				? text.orientationDetailDarwin
				: edges.platform === "win32"
					? text.orientationDetailWin32
					: text.orientationDetail;
		const canOpenSettings =
			edges.platform === "darwin" || edges.platform === "win32";
		yield* edges
			.prompt({
				title: text.orientationTitle,
				message: text.orientationMessage,
				detail,
				buttons: canOpenSettings
					? [text.openDisplaySettings, text.orientationLater]
					: [text.orientationLater],
				defaultId: 0,
				cancelId: canOpenSettings ? 1 : 0,
			})
			.pipe(
				Effect.flatMap((response) =>
					response === 0 && canOpenSettings
						? edges.openSettings().pipe(
								Effect.tap(() =>
									Effect.sync(() => {
										orientationShown = true;
									}),
								),
							)
						: Clock.currentTimeMillis.pipe(
								Effect.tap((at) =>
									Effect.sync(() => {
										orientationLater = at + LATER_MS;
									}),
								),
								Effect.asVoid,
							),
				),
				Effect.ensuring(
					Effect.sync(() => {
						busy = false;
					}),
				),
				Effect.ignore,
			);
		return false;
	});
	const prepareWindows = Effect.fn("DisplayPrompts.prepareWindows")(
		function* (): Effect.fn.Return<boolean, DisplayOperationFailed> {
			if (
				edges.mock ||
				edges.platform !== "win32" ||
				!edges.windowsExtend ||
				busy
			)
				return false;
			busy = true;
			const text = copy();
			return yield* Effect.gen(function* () {
				const response = yield* edges.prompt({
					title: text.title,
					message: text.message,
					detail: text.windowsExtendDetail,
					buttons: [text.switch, text.orientationLater],
					defaultId: 1,
					cancelId: 1,
				});
				if (response !== 0) return false;
				yield* edges.windowsExtend?.() ?? Effect.void;
				return true;
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						busy = false;
					}),
				),
			);
		},
	);
	return { check, repair, prepareWindows };
});
