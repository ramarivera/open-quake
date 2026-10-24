import { Clock, Effect, type Scope } from "effect";
import type { Display } from "electron";
import strings from "../../shared/lifecycle-strings.json";
import { type DisplayOperationFailed, farRightOrigins } from "./native-display";

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
		) => Effect.Effect<void>;
		repair: (
			display: Display | undefined,
		) => Effect.Effect<void, DisplayOperationFailed>;
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
	): Effect.fn.Return<void, DisplayOperationFailed> {
		if (!display || edges.mock || edges.platform !== "darwin" || busy) return;
		busy = true;
		yield* Effect.gen(function* () {
			const response = yield* edges.prompt({
				title: text.title,
				message: mirrored ? text.message : "Move Quake to the far right",
				detail:
					(mirrored ? mirrorDetail : "") +
					"\n\nWith your permission, open-quake will call CoreGraphics CGConfigureDisplayMirrorOfDisplay and CGConfigureDisplayOrigin through /usr/bin/osascript. This switches Quake to an extended display, makes another display primary when needed, and moves Quake to the far right. Other displays keep their relative positions.",
				buttons: [text.switch, text.orientationLater],
				defaultId: 1,
				cancelId: 1,
			});
			if (response === 0) yield* edges.native("fix", display);
			else layoutLater = (yield* Clock.currentTimeMillis) + 600_000;
		}).pipe(
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
	): Effect.fn.Return<void> {
		if (locked || edges.mock || busy) return;
		const now = yield* Clock.currentTimeMillis;
		if (!display) {
			if (
				edges.platform !== "darwin" ||
				!edges.hiddenMirroring ||
				now < layoutLater ||
				now < hiddenProbeAfter
			)
				return;
			hiddenProbeAfter = now + 10_000;
			if (
				!(yield* edges
					.hiddenMirroring()
					.pipe(Effect.orElseSucceed(() => false)))
			)
				return;
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
							layoutLater = now + 600_000;
						}),
					),
					Effect.ignore,
				);
			return;
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
				yield* repair(display, mode === "mirrored").pipe(Effect.ignore);
				return;
			}
		}
		if (display.size.height <= display.size.width) {
			verticalSince = undefined;
			landscapeAt = now;
			orientationShown = false;
			return;
		}
		if (now - landscapeAt < 6000) return;
		verticalSince ??= now;
		if (
			now - verticalSince < 2500 ||
			orientationShown ||
			now < orientationLater
		)
			return;
		busy = true;
		const detail =
			edges.platform === "darwin"
				? text.orientationDetailDarwin
				: edges.platform === "win32"
					? text.orientationDetailWin32
					: text.orientationDetail;
		yield* edges
			.prompt({
				title: text.orientationTitle,
				message: text.orientationMessage,
				detail,
				buttons: [text.openDisplaySettings, text.orientationLater],
				defaultId: 0,
				cancelId: 1,
			})
			.pipe(
				Effect.flatMap((response) =>
					response === 0
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
										orientationLater = at + 600_000;
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
	});
	return { check, repair };
});
