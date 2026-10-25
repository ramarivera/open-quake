import { Clock, Effect, type Scope } from "effect";
import type { Display } from "electron";
import strings from "../../shared/lifecycle-strings.json";
import { type DisplayOperationFailed, farRightOrigins } from "./native-display";

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
	readonly hiddenMirroring?: () => Effect.Effect<
		boolean,
		DisplayOperationFailed
	>;
	readonly platform: string;
	readonly mock: boolean;
	readonly displays: () => readonly Display[];
	readonly primaryId: () => number;
	readonly prompt: (
		request: PromptRequest,
	) => Effect.Effect<number, DisplayOperationFailed>;
	readonly openSettings: () => Effect.Effect<void, DisplayOperationFailed>;
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
		) => Effect.Effect<boolean, DisplayOperationFailed>;
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
	const text = strings.displayMode;
	const mirrorDetail = text.detail.replace(
		"Declining will disconnect the device.",
		"Later keeps the device connected and reminds you in 10 minutes.",
	);
	const repair = Effect.fn("DisplayPrompts.repair")(function* (
		display: Display | undefined,
		mirrored = false,
	): Effect.fn.Return<boolean, DisplayOperationFailed> {
		if (!display || edges.mock || edges.platform !== "darwin" || busy)
			return false;
		busy = true;
		return yield* Effect.gen(function* () {
			const response = yield* edges.prompt({
				title: text.title,
				message: mirrored ? text.message : "Move Quake to the far right",
				detail:
					(mirrored ? mirrorDetail : "") +
					"\n\nopen-quake will use Quake as a separate display and place it to the far right of your other screens. If Quake is your main display, another screen will become the main display. Your other screens will keep their positions relative to each other. You can change this arrangement later in System Settings > Displays.",
				buttons: [text.switch, text.orientationLater],
				defaultId: 1,
				cancelId: 1,
			});
			if (response === 0) yield* edges.native("fix", display);
			else layoutLater = (yield* Clock.currentTimeMillis) + LATER_MS;
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
	): Effect.fn.Return<boolean, DisplayOperationFailed> {
		if (locked || edges.mock || busy) return false;
		const now = yield* Clock.currentTimeMillis;
		if (!display) {
			if (
				edges.platform !== "darwin" ||
				!edges.hiddenMirroring ||
				now < layoutLater ||
				now < hiddenProbeAfter
			)
				return false;
			hiddenProbeAfter = now + 10_000;
			if (
				!(yield* edges
					.hiddenMirroring()
					.pipe(Effect.orElseSucceed(() => false)))
			)
				return false;
			busy = true;
			yield* edges
				.prompt({
					title: text.title,
					message: text.message,
					detail: mirrorDetail,
					buttons: [text.openDisplaySettings, text.orientationLater],
					defaultId: 1,
					cancelId: 1,
				})
				.pipe(
					Effect.flatMap((response) =>
						response === 0 ? edges.openSettings() : Effect.void,
					),
					Effect.ensuring(
						Effect.sync(() => {
							busy = false;
							layoutLater = now + LATER_MS;
						}),
					),
					Effect.ignore,
				);
			return false;
		}
		if (edges.platform === "darwin" && now >= layoutLater) {
			const mode = yield* edges
				.native("probe", display)
				.pipe(Effect.orElseSucceed(() => "unknown"));
			const origins = farRightOrigins(
				edges.displays(),
				display,
				edges.primaryId(),
			);
			const target = origins.find((origin) => origin.id === display.id);
			if (
				mode === "mirrored" ||
				(target &&
					(display.bounds.x !== target.x ||
						display.bounds.y !== target.y ||
						display.id === edges.primaryId()))
			) {
				return yield* repair(display, mode === "mirrored");
			}
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
	return { check, repair };
});
