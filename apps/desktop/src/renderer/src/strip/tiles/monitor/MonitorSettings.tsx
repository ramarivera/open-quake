import { Schema } from "effect";
import { useEffect, useState } from "react";
import {
	defaults,
	type MediaView,
	MonitorReply,
	type MonitorSettings as Settings,
	STYLES,
	type StyleId,
} from "../../../../../shared/monitor-contracts";
import { MonitorPanel } from "./MonitorPanel";
import { settingsLabels as l } from "./strings";
import { settingsWithoutMedia, useMonitor } from "./useMonitor";
import { previewSnapshot } from "./view-model";
import "./settings.css";

const preview = previewSnapshot();
export function MonitorSettings(): React.JSX.Element {
	const { view } = useMonitor();
	const [draft, setDraft] = useState<Settings>(defaults);
	const [revision, setRevision] = useState(0);
	const [dirty, setDirty] = useState(false),
		[busy, setBusy] = useState(false),
		[error, setError] = useState("");
	const [media, setMedia] = useState<Partial<Record<StyleId, MediaView>>>({});
	useEffect(() => {
		if (view && !dirty) {
			setDraft(view.settings);
			setRevision(view.revision);
			setMedia(view.media);
		}
	}, [view, dirty]);
	const change = (next: Settings): void => {
		setDraft(next);
		setDirty(true);
		setError("");
	};
	const choose = async (): Promise<void> => {
		if (!window.quakeMonitor) return;
		setBusy(true);
		setError("");
		try {
			const reply = await window.quakeMonitor.request({
				_tag: "chooseMedia",
				styleId: draft.styleId,
			});
			if (!Schema.is(MonitorReply)(reply)) {
				setError("Monitor response is invalid");
				return;
			}
			if (reply._tag === "media") {
				change({
					...draft,
					media: { ...draft.media, [draft.styleId]: reply.slot },
				});
				setMedia({ ...media, [draft.styleId]: reply.view });
			} else if (reply._tag === "failure") setError(reply.message);
		} catch {
			setError("Monitor settings are unavailable");
		} finally {
			setBusy(false);
		}
	};
	const save = async (): Promise<void> => {
		if (!window.quakeMonitor) return;
		setBusy(true);
		setError("");
		try {
			const reply = await window.quakeMonitor.request({
				_tag: "save",
				revision,
				settings: draft,
			});
			if (!Schema.is(MonitorReply)(reply)) {
				setError("Monitor response is invalid");
				return;
			}
			if (reply._tag === "success") {
				setDraft(reply.view.settings);
				setRevision(reply.view.revision);
				setMedia(reply.view.media);
				setDirty(false);
			} else if (reply._tag === "failure") setError(reply.message);
		} catch {
			setError("Monitor settings are unavailable");
		} finally {
			setBusy(false);
		}
	};
	const revert = (): void => {
		if (!view) return;
		setDraft(view.settings);
		setRevision(view.revision);
		setMedia(view.media);
		setDirty(false);
		setError("");
	};
	return (
		<section className="monitor-settings" aria-label="System monitor settings">
			<h2>SysView · Panel</h2>
			<p>Preview · Sample data</p>
			<div className="monitor-settings-preview">
				<div>
					<MonitorPanel
						settings={draft}
						snapshot={preview}
						media={media[draft.styleId]}
						preview
					/>
				</div>
			</div>
			<fieldset disabled={busy || !view}>
				<legend>{l.styleSection}</legend>
				<div className="monitor-style-options">
					{STYLES.map((style) => (
						<button
							key={style}
							type="button"
							aria-pressed={draft.styleId === style}
							data-monitor-style={style}
							onClick={() => change({ ...draft, styleId: style })}
						>
							<span className={`monitor-style-swatch swatch-${style}`} />
							{l.style[style]}
						</button>
					))}
				</div>
			</fieldset>
			<fieldset disabled={busy || !view}>
				<legend>{l.bgSection}</legend>
				<p>{l.bgCurrentStyle.replace("{name}", l.style[draft.styleId])}</p>
				<div className="monitor-bg-options">
					{(["style", "none", "custom"] as const).map((mode) => (
						<button
							key={mode}
							type="button"
							aria-pressed={draft.background === mode}
							onClick={() => change({ ...draft, background: mode })}
						>
							{l.bgMode[mode]}
						</button>
					))}
				</div>
				<div className="monitor-media-actions">
					<button
						type="button"
						disabled={draft.background !== "custom"}
						onClick={() => void choose()}
					>
						{l.bgChange}
					</button>
					<button
						type="button"
						disabled={!draft.media[draft.styleId]}
						onClick={() => {
							change(settingsWithoutMedia(draft, draft.styleId));
							const next = { ...media };
							delete next[draft.styleId];
							setMedia(next);
						}}
					>
						{l.bgRestore}
					</button>
				</div>
				{draft.media[draft.styleId] ? (
					<p>{draft.media[draft.styleId]?.name}</p>
				) : null}
				{media[draft.styleId]?.available === false ? (
					<p role="status">{l.bgInvalid}</p>
				) : null}
			</fieldset>
			<fieldset disabled={busy || !view}>
				<legend>Temperature Unit</legend>
				<label>
					<input
						type="radio"
						name="monitor-temperature"
						checked={draft.temperatureUnit === "celsius"}
						onChange={() => change({ ...draft, temperatureUnit: "celsius" })}
					/>{" "}
					Celsius
				</label>
				<label>
					<input
						type="radio"
						name="monitor-temperature"
						checked={draft.temperatureUnit === "fahrenheit"}
						onChange={() => change({ ...draft, temperatureUnit: "fahrenheit" })}
					/>{" "}
					Fahrenheit
				</label>
			</fieldset>
			<fieldset disabled={busy || !view}>
				<legend>Sampling</legend>
				<label>
					<input
						type="checkbox"
						checked={draft.enabled}
						onChange={(event) =>
							change({ ...draft, enabled: event.target.checked })
						}
					/>{" "}
					Enable monitoring
				</label>
				<label>
					Samples per second{" "}
					<input
						aria-label="Samples per second"
						type="number"
						min="0.2"
						max="10"
						step="0.2"
						value={draft.hz}
						onChange={(event) =>
							change({ ...draft, hz: event.target.valueAsNumber })
						}
					/>
				</label>
				<p>0.2–10 Hz. Default: 1 Hz.</p>
			</fieldset>
			{error ? <p role="alert">{error}</p> : null}
			{!view ? <p role="status">Monitor settings are unavailable</p> : null}
			{view?.recovered ? (
				<p role="status">Saved settings were invalid. Defaults are shown.</p>
			) : null}
			<div className="monitor-save">
				<button type="button" disabled={!dirty || busy} onClick={revert}>
					Revert
				</button>
				<button
					type="button"
					disabled={
						!dirty ||
						busy ||
						!Number.isFinite(draft.hz) ||
						draft.hz < 0.2 ||
						draft.hz > 10
					}
					onClick={() => void save()}
				>
					Save
				</button>
			</div>
		</section>
	);
}
