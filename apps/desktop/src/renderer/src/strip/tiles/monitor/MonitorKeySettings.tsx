import { Schema } from "effect";
import { useEffect, useState } from "react";
import type { ProfileKey } from "../../../../../../../../packages/device/src/profiles/profile-contracts";
import {
	type MediaView,
	MonitorReply,
	STYLES,
	StyleId,
} from "../../../../../shared/monitor-contracts";
import { Row } from "../../../ui/Form";
import { monitorKeySettings, withMonitorKeySettings } from "./key-settings";
import { MonitorPanel } from "./MonitorPanel";
import { settingsLabels as l } from "./strings";
import { previewSnapshot } from "./view-model";
import "./settings.css";

export const isMonitorKey = (key: ProfileKey): boolean =>
	["systemMonitorPanel", "cpuInfo", "gpuInfo"].includes(key.config.type);
export function useMonitorKeyMedia(
	slot: ReturnType<typeof monitorKeySettings>["media"][StyleId],
): MediaView | undefined {
	const [resolved, setResolved] = useState<{ id: string; view: MediaView }>();
	const id = slot?.id,
		kind = slot?.kind,
		name = slot?.name;
	useEffect(() => {
		let active = true;
		const slot =
			id && kind && name !== undefined ? { id, kind, name } : undefined;
		if (slot && window.quakeMonitor)
			void window.quakeMonitor
				.request({ _tag: "resolveMedia", slot })
				.then((reply) => {
					if (
						active &&
						Schema.is(MonitorReply)(reply) &&
						reply._tag === "media"
					)
						setResolved({ id: slot.id, view: reply.view });
					else if (active)
						setResolved({
							id: slot.id,
							view: { kind: slot.kind, available: false, url: "" },
						});
				})
				.catch(() => {
					if (active)
						setResolved({
							id: slot.id,
							view: { kind: slot.kind, available: false, url: "" },
						});
				});
		return () => {
			active = false;
		};
	}, [id, kind, name]);
	return slot && resolved?.id === slot.id ? resolved.view : undefined;
}
export function MonitorKeySettings({
	keyValue,
	onChange,
	locale = "en",
}: {
	keyValue: ProfileKey;
	onChange: (key: ProfileKey) => void;
	locale?: string;
}): React.JSX.Element {
	const settings = monitorKeySettings(keyValue),
		panel = keyValue.config.type === "systemMonitorPanel";
	const media = useMonitorKeyMedia(settings.media[settings.styleId]);
	const [chosen, setChosen] = useState<{ id: string; view: MediaView }>();
	const [error, setError] = useState(""),
		[busy, setBusy] = useState(false);
	const change = (next: typeof settings) =>
		onChange(withMonitorKeySettings(keyValue, next));
	const choose = async () => {
		if (!window.quakeMonitor || busy) return;
		setBusy(true);
		setError("");
		try {
			const reply = await window.quakeMonitor.request({
				_tag: "chooseMedia",
				styleId: settings.styleId,
			});
			if (!Schema.is(MonitorReply)(reply)) {
				setError("Monitor response is invalid");
				return;
			}
			if (reply._tag === "media") {
				setChosen({ id: reply.slot.id, view: reply.view });
				change({
					...settings,
					background: "custom",
					media: { ...settings.media, [settings.styleId]: reply.slot },
				});
			} else if (reply._tag === "failure") setError(reply.message);
		} catch {
			setError("Monitor settings are unavailable");
		} finally {
			setBusy(false);
		}
	};
	const slot = settings.media[settings.styleId];
	const copy =
		locale === "de"
			? {
					style: "Panel-Stil",
					background: "Panel-Hintergrund",
					builtin: "Integriert",
					none: "Keiner",
					custom: "Eigener",
					change: "Hintergrund ändern",
					restore: "Standardhintergrund wiederherstellen",
				}
			: {
					style: l.styleSection,
					background: l.bgSection,
					builtin: l.bgMode.style,
					none: l.bgMode.none,
					custom: l.bgMode.custom,
					change: l.bgChange,
					restore: l.bgRestore,
				};
	return (
		<fieldset
			disabled={busy}
			aria-label={
				locale === "de" ? "Monitor-Einstellungen" : "Monitor settings"
			}
		>
			{panel ? (
				<>
					<div className="monitor-settings-preview">
						<div>
							<MonitorPanel
								settings={settings}
								snapshot={previewSnapshot()}
								media={chosen?.id === slot?.id ? chosen?.view : media}
								preview
							/>
						</div>
					</div>
					<Row label={copy.style}>
						<select
							aria-label={copy.style}
							value={settings.styleId}
							onChange={(e) => {
								if (Schema.is(StyleId)(e.target.value))
									change({ ...settings, styleId: e.target.value });
							}}
						>
							{STYLES.map((s) => (
								<option key={s} value={s}>
									{l.style[s]}
								</option>
							))}
						</select>
					</Row>
					<Row label={copy.background}>
						<select
							aria-label={copy.background}
							value={settings.background}
							onChange={(e) => {
								const background = e.target.value;
								if (
									background === "style" ||
									background === "none" ||
									background === "custom"
								)
									change({ ...settings, background });
							}}
						>
							<option value="style">{copy.builtin}</option>
							<option value="none">{copy.none}</option>
							<option value="custom">{copy.custom}</option>
						</select>
					</Row>
					<button
						type="button"
						disabled={settings.background !== "custom"}
						onClick={() => void choose()}
					>
						{copy.change}
					</button>
					<button
						type="button"
						onClick={() => {
							const next = { ...settings.media };
							delete next[settings.styleId];
							change({ ...settings, background: "style", media: next });
						}}
					>
						{copy.restore}
					</button>
					{slot ? <p>{slot.name}</p> : null}
				</>
			) : null}
			<Row label={locale === "de" ? "Temperatureinheit" : "Temperature Unit"}>
				<select
					aria-label="Temperature Unit"
					value={settings.temperatureUnit}
					onChange={(e) =>
						change({
							...settings,
							temperatureUnit:
								e.target.value === "fahrenheit" ? "fahrenheit" : "celsius",
						})
					}
				>
					<option value="celsius">°C</option>
					<option value="fahrenheit">°F</option>
				</select>
			</Row>
			<p>
				{locale === "de"
					? "Änderungen werden mit dem Profil gespeichert."
					: "Changes apply when you save the profile."}
			</p>
			{error ? <p role="alert">{error}</p> : null}
		</fieldset>
	);
}
