import { Schema } from "effect";
import { useEffect, useId, useState } from "react";
import {
	defaults,
	type MediaView,
	MonitorReply,
	type MonitorSettings as Settings,
	STYLES,
	type StyleId,
} from "../../../../../shared/monitor-contracts";
import { Callout, Group, Row, Segmented } from "../../../ui/Form";
import { MonitorPanel } from "./MonitorPanel";
import { settingsLabels as l } from "./strings";
import { settingsWithoutMedia, useMonitor } from "./useMonitor";
import { previewSnapshot } from "./view-model";
import "./settings.css";

const preview = previewSnapshot();
export function MonitorSettings(): React.JSX.Element {
	const { view } = useMonitor();
	const ids = useId();
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
	const selectedId = draft.media[draft.styleId]?.id;
	useEffect(() => {
		const bridge = window.quakeMonitor;
		if (!bridge || draft.background !== "custom" || !selectedId) return;
		let active = true;
		const styleId = draft.styleId;
		void bridge
			.request({ _tag: "read", styleId })
			.then((reply) => {
				if (
					active &&
					Schema.is(MonitorReply)(reply) &&
					reply._tag === "success" &&
					reply.view.revision === revision &&
					reply.view.settings.media[styleId]?.id === selectedId
				) {
					const loaded = reply.view.media[styleId];
					if (loaded)
						setMedia((current) => ({ ...current, [styleId]: loaded }));
				}
			})
			.catch(() => {
				if (active) setError("Monitor settings are unavailable");
			});
		return () => {
			active = false;
		};
	}, [draft.background, draft.styleId, selectedId, revision]);
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
			<fieldset className="monitor-fieldset" disabled={busy || !view}>
				<Group
					title="System monitor panel"
					description="Preview with sample data. Changes apply when you save."
				>
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
					<Row label={l.styleSection} labelId={`${ids}-style`} align="start">
						<fieldset
							className="monitor-style-options"
							aria-labelledby={`${ids}-style`}
						>
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
						</fieldset>
					</Row>
					<Row
						label={l.bgSection}
						labelId={`${ids}-bg`}
						hint={l.bgCurrentStyle.replace("{name}", l.style[draft.styleId])}
						align="start"
					>
						<div className="monitor-bg-controls">
							<Segmented
								name={`${ids}-bg`}
								labelledBy={`${ids}-bg`}
								value={draft.background}
								options={(["style", "none", "custom"] as const).map((mode) => ({
									value: mode,
									label: l.bgMode[mode],
								}))}
								onChange={(mode) => change({ ...draft, background: mode })}
							/>
							<div className="monitor-media-actions">
								<button
									type="button"
									className="button"
									disabled={draft.background !== "custom"}
									onClick={() => void choose()}
								>
									{l.bgChange}
								</button>
								<button
									type="button"
									className="button"
									data-variant="quiet"
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
								<p className="monitor-media-name">
									{draft.media[draft.styleId]?.name}
								</p>
							) : null}
							{media[draft.styleId]?.available === false ? (
								<p className="monitor-media-error" role="status">
									{l.bgInvalid}
								</p>
							) : null}
						</div>
					</Row>
				</Group>
				<Group title="Readings">
					<Row label="Temperature unit" labelId={`${ids}-unit`}>
						<Segmented
							name="monitor-temperature"
							labelledBy={`${ids}-unit`}
							value={draft.temperatureUnit}
							options={[
								{ value: "celsius", label: "Celsius" },
								{ value: "fahrenheit", label: "Fahrenheit" },
							]}
							onChange={(unit) => change({ ...draft, temperatureUnit: unit })}
						/>
					</Row>
					<Row label="Enable monitoring" htmlFor={`${ids}-enabled`}>
						<input
							id={`${ids}-enabled`}
							type="checkbox"
							checked={draft.enabled}
							onChange={(event) =>
								change({ ...draft, enabled: event.target.checked })
							}
						/>
					</Row>
					<Row
						label="Samples per second"
						htmlFor={`${ids}-hz`}
						hint="0.2–10 Hz. Default: 1 Hz."
					>
						<input
							id={`${ids}-hz`}
							className="text-field monitor-hz"
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
					</Row>
				</Group>
			</fieldset>
			<div className="monitor-footer">
				<div role="status" aria-live="polite" className="status-notes">
					{error ? <Callout tone="warning">{error}</Callout> : null}
					{!view ? (
						<Callout tone="warning">Monitor settings are unavailable</Callout>
					) : null}
					{view?.recovered ? (
						<Callout tone="warning">
							Saved settings were invalid. Defaults are shown.
						</Callout>
					) : null}
				</div>
				<div className="monitor-save">
					<button
						type="button"
						className="button"
						disabled={!dirty || busy}
						onClick={revert}
					>
						Revert
					</button>
					<button
						type="button"
						className="button"
						data-primary=""
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
			</div>
		</section>
	);
}
