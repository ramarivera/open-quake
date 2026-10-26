import { Schema } from "effect";
import { useEffect, useId, useState } from "react";
import { monitoringClient } from "../../../../../../../../packages/client/src/monitor";
import {
	effectiveMonitoring,
	type ForegroundSnapshot,
} from "../../../../../../../../packages/edge/src/monitor/monitor-config";
import {
	type MetricSample,
	MODULES,
	type ModuleId,
} from "../../../../../../../../packages/edge/src/monitor/monitor-contracts";
import {
	defaults,
	type MonitoringSnapshot,
	MonitorReply,
	type MonitorSettings as Settings,
	type SettingsView,
} from "../../../../../shared/monitor-contracts";
import { Callout, Group, Row, StatusDot } from "../../../ui/Form";
import { MonitorPanel } from "./MonitorPanel";
import { settingsLabels as l } from "./strings";
import { useMonitor } from "./useMonitor";
import { previewSnapshot } from "./view-model";
import "./settings.css";

const preview = previewSnapshot();
const validHz = (hz: number): boolean =>
	Number.isFinite(hz) && hz >= 0.2 && hz <= 10;
const hzText = (hz: number): string => String(Number(hz.toFixed(1)));
/** Toggles one metric, keeping the list unique and in panel order. */
const toggle = (list: readonly ModuleId[], id: ModuleId): ModuleId[] =>
	list.includes(id)
		? list.filter((m) => m !== id)
		: MODULES.filter((m) => m === id || list.includes(m));

function MetricPicker({
	labelledBy,
	value,
	disabled,
	onChange,
}: {
	labelledBy: string;
	value: readonly ModuleId[];
	disabled: boolean;
	onChange: (metrics: ModuleId[]) => void;
}): React.JSX.Element {
	return (
		<fieldset
			className="monitor-metric-options"
			aria-labelledby={labelledBy}
			disabled={disabled}
		>
			{MODULES.map((id) => (
				<button
					key={id}
					type="button"
					aria-pressed={value.includes(id)}
					data-monitor-metric={id}
					onClick={() => onChange(toggle(value, id))}
				>
					{l.metric[id]}
				</button>
			))}
		</fieldset>
	);
}

type LiveState = keyof typeof l.state;
const liveState = (sample: MetricSample, collected: boolean): LiveState =>
	!collected
		? "off"
		: sample.state === "available"
			? "live"
			: sample.state === "unavailable"
				? "waiting"
				: sample.state;
const liveTone: Record<LiveState, string> = {
	live: "success",
	stale: "warning",
	"permission-denied": "warning",
	error: "danger",
	unsupported: "neutral",
	waiting: "neutral",
	off: "neutral",
};

/** App display name from the executable path; the path itself is never shown. */
export const appName = (path: string): string => {
	const parts = path.split(/[\\/]/).filter(Boolean);
	const name =
		parts.filter((part) => /\.app$/i.test(part)).at(-1) ?? parts.at(-1);
	return name?.replace(/\.(app|exe)$/i, "") ?? "";
};
function useMonitoringState(): MonitoringSnapshot | undefined {
	const [state, setState] = useState<MonitoringSnapshot>();
	useEffect(() => {
		const bridge = window.quakeMonitor;
		if (!bridge) return;
		let active = true;
		const client = monitoringClient(bridge);
		let received = false;
		const off = client.subscribe((value) => {
			if (active) {
				received = true;
				setState(value);
			}
		});
		void client
			.snapshot()
			.then((value) => {
				if (active && !received) setState(value);
			})
			.catch(() => undefined);
		void bridge.request({ _tag: "watch", active: true }).catch(() => undefined);
		return () => {
			active = false;
			off();
			void bridge
				.request({ _tag: "watch", active: false })
				.catch(() => undefined);
		};
	}, []);
	return state;
}

/** Real collector state from saved settings. Not aria-live: it ticks up to 10 Hz. */
function LiveStatus({
	view,
	dirty,
}: {
	view: SettingsView | undefined;
	dirty: boolean;
}): React.JSX.Element {
	const state = useMonitoringState();
	const saved = view?.settings;
	const on = saved?.enabled === true;
	const now = saved ? effectiveMonitoring(saved) : undefined;
	const [tone, text] = !saved
		? ["unavailable", l.liveUnavailable]
		: !on
			? ["offline", l.liveOff]
			: saved.override.active
				? [
						"simulated",
						l.liveOverride.replace("{hz}", hzText(saved.override.hz)),
					]
				: ["connected", l.liveRunning.replace("{hz}", hzText(saved.hz))];
	return (
		<Group
			title={l.liveSection}
			description={dirty ? l.liveUnsaved : l.liveDescription}
		>
			<Row label={l.liveMonitoring}>
				<StatusDot tone={tone} />
				<span className="value" data-testid="monitor-live-monitoring">
					{text}
				</span>
			</Row>
			<Row label={l.metrics} align="start">
				<div className="monitor-live-metrics">
					{MODULES.map((id) => {
						const sample = state?.metrics.samples.find((s) => s.id === id) ?? {
							id,
							state: "unavailable" as const,
							collectedAt: 0,
							values: {},
						};
						const live = liveState(sample, now?.metrics.includes(id) === true);
						return (
							<span
								key={id}
								className="mc-badge"
								data-tone={liveTone[live]}
								data-testid={`monitor-live-${id}`}
								data-state={live}
							>
								{l.metric[id]} · {l.state[live]}
							</span>
						);
					})}
				</div>
			</Row>
			{saved?.appMonitor.enabled ? (
				<Row label={l.liveForeground}>
					<Foreground on={on} value={state?.foreground} />
				</Row>
			) : null}
		</Group>
	);
}

/** App identity only. A window title never reaches this component. */
function Foreground({
	on,
	value,
}: {
	on: boolean;
	value: ForegroundSnapshot | undefined;
}): React.JSX.Element {
	if (on && value?.state === "available")
		return (
			<span className="value" data-testid="monitor-live-foreground">
				{(value.window && appName(value.window.path)) || l.foreground.none}
			</span>
		);
	const state =
		!on || value?.state === "disabled"
			? "off"
			: !value || value.state === "unavailable" || value.state === "available"
				? "waiting"
				: value.state;
	return (
		<span
			className="mc-badge"
			data-tone={
				state === "error"
					? "danger"
					: state === "permission-denied"
						? "warning"
						: "neutral"
			}
			data-testid="monitor-live-foreground"
			data-state={state}
		>
			{l.foreground[state]}
		</span>
	);
}

export function MonitorSettings(): React.JSX.Element {
	const { view } = useMonitor();
	const ids = useId();
	const [draft, setDraft] = useState<Settings>(defaults);
	const [revision, setRevision] = useState(0);
	const [dirty, setDirty] = useState(false),
		[busy, setBusy] = useState(false),
		[error, setError] = useState("");
	useEffect(() => {
		if (view && !dirty) {
			setDraft(view.settings);
			setRevision(view.revision);
		}
	}, [view, dirty]);
	const change = (next: Settings): void => {
		setDraft(next);
		setDirty(true);
		setError("");
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
		setDirty(false);
		setError("");
	};
	const off = !draft.enabled;
	const valid =
		validHz(draft.hz) &&
		validHz(draft.override.hz) &&
		draft.metrics.length > 0 &&
		draft.override.metrics.length > 0;
	const metricsHint = (metrics: readonly ModuleId[], hint: string) =>
		metrics.length > 0 ? (
			hint
		) : (
			<span className="monitor-field-error">{l.metricsEmpty}</span>
		);
	return (
		<section className="monitor-settings" aria-label="System monitor settings">
			<fieldset className="monitor-fieldset" disabled={busy || !view}>
				<Group
					title="System monitor panel"
					description="Set each panel's style, background and temperature unit in the Keys editor. This preview uses sample data."
				>
					<div className="monitor-settings-preview">
						<div>
							<MonitorPanel settings={defaults()} snapshot={preview} preview />
						</div>
					</div>
				</Group>
				<LiveStatus view={view} dirty={dirty} />
				<Group
					title={l.readingsSection}
					description={
						view?.settings.enabled && view.settings.override.active
							? l.readingsDuringOverride
							: undefined
					}
				>
					<Row label={l.enable} hint={l.enableHint} htmlFor={`${ids}-enabled`}>
						<input
							id={`${ids}-enabled`}
							type="checkbox"
							checked={draft.enabled}
							onChange={(event) =>
								change({ ...draft, enabled: event.target.checked })
							}
						/>
					</Row>
					<Row label={l.rate} htmlFor={`${ids}-hz`} hint={l.rateHint}>
						<input
							id={`${ids}-hz`}
							className="text-field monitor-hz"
							aria-label={l.rate}
							type="number"
							min="0.2"
							max="10"
							step="0.2"
							value={draft.hz}
							disabled={off}
							onChange={(event) =>
								change({ ...draft, hz: event.target.valueAsNumber })
							}
						/>
					</Row>
					<Row
						label={l.metrics}
						labelId={`${ids}-metrics`}
						hint={metricsHint(draft.metrics, l.metricsHint)}
						align="start"
					>
						<MetricPicker
							labelledBy={`${ids}-metrics`}
							value={draft.metrics}
							disabled={off}
							onChange={(metrics) => change({ ...draft, metrics })}
						/>
					</Row>
				</Group>
				<Group title={l.appSection}>
					<Row label={l.appTrack} hint={l.appTrackHint} htmlFor={`${ids}-app`}>
						<input
							id={`${ids}-app`}
							type="checkbox"
							checked={draft.appMonitor.enabled}
							disabled={off}
							onChange={(event) =>
								change({
									...draft,
									appMonitor: { enabled: event.target.checked },
								})
							}
						/>
					</Row>
				</Group>
				<Group title={l.overrideSection} description={l.overrideDescription}>
					<Row
						label={l.overrideUse}
						hint={l.overrideUseHint}
						htmlFor={`${ids}-override`}
					>
						<input
							id={`${ids}-override`}
							type="checkbox"
							checked={draft.override.active}
							disabled={off}
							onChange={(event) =>
								change({
									...draft,
									override: { ...draft.override, active: event.target.checked },
								})
							}
						/>
					</Row>
					<Row label={l.rate} htmlFor={`${ids}-override-hz`} hint={l.rateHint}>
						<input
							id={`${ids}-override-hz`}
							className="text-field monitor-hz"
							aria-label={l.overrideRateAria}
							type="number"
							min="0.2"
							max="10"
							step="0.2"
							value={draft.override.hz}
							disabled={off}
							onChange={(event) =>
								change({
									...draft,
									override: {
										...draft.override,
										hz: event.target.valueAsNumber,
									},
								})
							}
						/>
					</Row>
					<Row
						label={l.metrics}
						labelId={`${ids}-override-metrics`}
						hint={metricsHint(draft.override.metrics, l.overrideMetricsHint)}
						align="start"
					>
						<MetricPicker
							labelledBy={`${ids}-override-metrics`}
							value={draft.override.metrics}
							disabled={off}
							onChange={(metrics) =>
								change({ ...draft, override: { ...draft.override, metrics } })
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
						disabled={!dirty || busy || !valid}
						onClick={() => void save()}
					>
						Save
					</button>
				</div>
			</div>
		</section>
	);
}
