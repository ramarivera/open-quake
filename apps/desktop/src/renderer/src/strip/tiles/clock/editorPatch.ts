import { Predicate, Schema } from "effect";
import {
	ProfileAction,
	type ProfileKey,
} from "../../../../../../../../packages/device/src/profiles/profile-contracts";
import type { ClockSnapshot } from "../../../../../shared/clock-contracts";
import { normalizeClockStyle } from "../../../../../shared/clock-style";

/** Patch only the committed clock field. Unsaved format/title/other actions survive. */
export function patchClockEditorKey(
	key: ProfileKey,
	snapshot: ClockSnapshot,
): ProfileKey {
	const actions = key.config.actions;
	const upsert = (type: string, value: unknown): ProfileKey => {
		const action = Schema.decodeUnknownSync(ProfileAction)({ type, value });
		return {
			...key,
			config: {
				...key.config,
				actions: actions.some((a) => a.type === type)
					? actions.map((a) => (a.type === type ? action : a))
					: [...actions, action],
			},
		};
	};
	const styleRaw = actions.find((a) => a.type === "clockStyle")?.value;
	const record = (value: unknown): Readonly<Record<string, unknown>> =>
		Predicate.isRecord(value) ? value : {};
	const extra = record(styleRaw);
	const normalized = normalizeClockStyle(styleRaw);
	const style = {
		...extra,
		...normalized,
		background: { ...normalized.background, ...record(extra.background) },
	};
	const saved = (type: string) =>
		snapshot.actions?.find((a) => a.type === type)?.value;
	switch (snapshot.change) {
		case "setTheme":
		case "setMode":
			return upsert("clockStyle", {
				...style,
				background: {
					...style.background,
					mode: snapshot.mode,
					themeId: snapshot.themeId,
				},
			});
		case "setMusic":
			return upsert("clockStyle", {
				...style,
				musicEnabled: snapshot.musicEnabled ?? style.musicEnabled,
			});
		case "setHourFormat":
			return upsert("hourFormat", snapshot.hourFormat ?? "24h");
		case "setSeconds":
			return upsert("showSeconds", snapshot.showSeconds);
		case "chooseMedia":
		case "commitMedia":
		case "restoreMedia":
			return saved("clockStyle") === undefined
				? key
				: upsert("clockStyle", saved("clockStyle"));
		case "setWeather": {
			if (saved("weather") !== undefined)
				return upsert("weather", saved("weather"));
			if (!snapshot.weather) return key;
			const weather = snapshot.weather;
			const raw = actions.find((a) => a.type === "weather")?.value;
			const old =
				typeof raw === "object" && raw !== null && !Array.isArray(raw)
					? raw
					: {};
			return upsert("weather", {
				...old,
				enabled: weather.enabled,
				city: weather.city,
				location: weather.location,
				unit: weather.unit,
				ipLookup: weather.ipLookup,
				service: { forecastUrl: weather.forecastUrl },
			});
		}
		default:
			return key;
	}
}
