import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import { DeviceScreen } from "../ui/DeviceScreen";
import { Group, PageHeader, Row, StatusDot } from "../ui/Form";
import type { QuakeEventsView } from "../useQuakeEvents";
import { type ConnectionSummary, recentActivity } from "./connection";

const KNOB_DEGREES_PER_STEP = 15;
const ACTIVITY_LIMIT = 6;

function Counter({
	label,
	value,
}: {
	label: string;
	value: number;
}): React.JSX.Element {
	return (
		<div className="counter">
			<span className="counter-value">
				{/* Re-keyed so the change animation replays, when motion is on. */}
				<span key={value} className="value-change">
					{value}
				</span>
			</span>
			<span className="counter-label">{label}</span>
		</div>
	);
}

function KnobDial({
	steps,
	presses,
}: {
	steps: number;
	presses: number;
}): React.JSX.Element {
	return (
		<div className="knob" aria-hidden="true">
			<span key={presses} className="knob-press" data-pressed={presses > 0} />
			<span
				className="knob-cap"
				style={{
					transform: `rotate(${steps * KNOB_DEGREES_PER_STEP}deg)`,
				}}
			>
				<span className="knob-marker" />
			</span>
		</div>
	);
}

function heartbeatText(
	connection: ConnectionSummary,
	seq: number | null,
): string {
	if (seq !== null) return `#${seq}`;
	return connection.tone === "connected" || connection.tone === "simulated"
		? "Waiting for the first heartbeat"
		: "None";
}

export function OverviewPage({
	quake,
	connection,
	snapshot,
	onOpenScreen,
}: {
	quake: QuakeEventsView;
	connection: ConnectionSummary;
	snapshot: WallpaperSnapshot | undefined;
	onOpenScreen: () => void;
}): React.JSX.Element {
	const activity = recentActivity(
		quake.events,
		quake.eventsReceived,
		ACTIVITY_LIMIT,
	);
	return (
		<>
			<PageHeader
				title="Overview"
				description="Your QUAKE, its connection, and what its screen is showing."
			/>
			<section className="device-stage" aria-labelledby="device-headline">
				<DeviceScreen snapshot={snapshot} size="large" />
				<div className="device-summary" data-tone={connection.tone}>
					<StatusDot tone={connection.tone} />
					<div className="device-summary-text">
						<h2 id="device-headline">{connection.headline}</h2>
						<p>{connection.detail}</p>
					</div>
					<button type="button" className="button" onClick={onOpenScreen}>
						Edit Screen…
					</button>
				</div>
			</section>

			<Group title="Connection">
				<Row label="Link">
					<span className="value">{connection.link ?? "—"}</span>
				</Row>
				<Row
					label="Heartbeat"
					hint="Latest reply to open-quake's periodic keep-alive ping."
				>
					<span className="value mono">
						{heartbeatText(connection, quake.lastKeepAliveSeq)}
					</span>
				</Row>
				{connection.code ? (
					<Row label="Error code">
						<span className="value mono">{connection.code}</span>
					</Row>
				) : null}
			</Group>

			<Group
				title="Live input"
				description="Counts everything the device has sent since open-quake started."
			>
				<div className="knob-monitor">
					<KnobDial steps={quake.knobSteps} presses={quake.presses} />
					<div className="counters">
						<Counter label="Turns" value={quake.rotations} />
						<Counter label="Presses" value={quake.presses} />
						<Counter label="Events" value={quake.eventsReceived} />
					</div>
				</div>
				<div className="activity" aria-live="polite">
					<h3 className="activity-title">Recent activity</h3>
					{activity.length ? (
						<ol className="activity-list">
							{activity.map((entry) => (
								<li key={entry.ordinal}>
									<span>{entry.text}</span>
									<span className="mono muted">#{entry.ordinal}</span>
								</li>
							))}
						</ol>
					) : (
						<p className="activity-empty">
							Nothing yet. Turn or press the knob.
						</p>
					)}
				</div>
			</Group>
		</>
	);
}
