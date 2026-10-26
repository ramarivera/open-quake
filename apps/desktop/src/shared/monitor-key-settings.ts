import { Schema } from "effect";
import type { ProfileKey } from "../../../../packages/device/src/profiles/profile-contracts";
import {
	defaults,
	MediaSlot,
	type MonitorSettings,
	StyleId,
} from "./monitor-contracts";

/** Explicit per-key fields win; legacy absent fields inherit the saved global presentation. */
export function monitorKeySettings(
	key: ProfileKey,
	sampling: MonitorSettings = defaults(),
): MonitorSettings {
	const action = key.config.actions.find(
		(a) => a.type === "monitorStyle",
	)?.value;
	const object = Schema.decodeUnknownEither(
		Schema.Struct({
			styleId: Schema.optional(Schema.Unknown),
			background: Schema.optional(
				Schema.Struct({
					mode: Schema.optional(Schema.Unknown),
					themes: Schema.optional(
						Schema.Record({ key: Schema.String, value: Schema.Unknown }),
					),
				}),
			),
		}),
	)(action);
	const style = object._tag === "Right" ? object.right : {};
	const background = "background" in style ? style.background : undefined;
	const slots = background?.themes ?? sampling.media;
	const media: MonitorSettings["media"] = Object.fromEntries(
		Object.entries(slots).flatMap(([style, slot]) =>
			Schema.is(StyleId)(style) && Schema.is(MediaSlot)(slot)
				? [[style, slot]]
				: [],
		),
	);
	const styleId = "styleId" in style ? style.styleId : undefined;
	return {
		...sampling,
		styleId: Schema.is(StyleId)(styleId) ? styleId : sampling.styleId,
		temperatureUnit: key.config.temperatureUnit ?? sampling.temperatureUnit,
		background:
			background?.mode === "custom" ||
			background?.mode === "none" ||
			background?.mode === "style"
				? background?.mode
				: sampling.background,
		media,
	};
}
export function withMonitorKeySettings(
	key: ProfileKey,
	settings: MonitorSettings,
): ProfileKey {
	return {
		...key,
		config: {
			...key.config,
			temperatureUnit: settings.temperatureUnit,
			actions: [
				...key.config.actions.filter((a) => a.type !== "monitorStyle"),
				...(key.config.type === "systemMonitorPanel"
					? [
							{
								type: "monitorStyle",
								value: {
									styleId: settings.styleId,
									background: {
										mode: settings.background,
										themes: settings.media,
									},
								},
							},
						]
					: []),
			],
		},
	};
}
