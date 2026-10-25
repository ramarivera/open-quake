import type { WallpaperSnapshot } from "../../../shared/wallpaper-contracts";
import { DeviceScreen } from "../ui/DeviceScreen";
import { Group, PageHeader, Row, StatusDot } from "../ui/Form";
import type { QuakeEventsView } from "../useQuakeEvents";
import { type ConnectionSummary, recentActivity } from "./connection";

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
	onOpenConnection,
}: {
	quake: QuakeEventsView;
	connection: ConnectionSummary;
	snapshot: WallpaperSnapshot | undefined;
	onOpenScreen: () => void;
	onOpenConnection: () => void;
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
			>
				<button type="button" className="button" onClick={onOpenScreen}>
					Edit screen…
				</button>
			</PageHeader>
			<section className="overview-hero" aria-labelledby="device-headline">
				<DeviceScreen snapshot={snapshot} size="large" />
				<div className="device-summary" data-tone={connection.tone}>
					<StatusDot tone={connection.tone} />
					<div className="device-summary-text">
						<h2 id="device-headline">{connection.headline}</h2>
						<p>{connection.detail}</p>
					</div>
				</div>
			</section>

			<div className="overview-columns">
				<Group
					title="Connection"
					footer={
						<button type="button" className="button" onClick={onOpenConnection}>
							Check USB and HDMI…
						</button>
					}
				>
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
					description="Everything the device has sent since open-quake started."
				>
					<div className="counters">
						<Counter label="Knob turns" value={quake.rotations} />
						<Counter label="Presses" value={quake.presses} />
						<Counter label="Events" value={quake.eventsReceived} />
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
			</div>
		</>
	);
}
