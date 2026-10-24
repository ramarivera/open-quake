import "./integrations.css";
import { useCallback, useEffect, useState } from "react";
import { CHANNEL_CATALOG } from "../../../../../../../packages/edge/src/channels/channel-catalog";
import type {
	ChannelDescriptor,
	ChannelView,
} from "../../../../../../../packages/edge/src/channels/channel-contracts";
import { ChannelSetupDrawer } from "./ChannelSetupDrawer";
import { channelDeleteConfirm, channelStrings as s } from "./strings";
import { useIntegrations } from "./useIntegrations";
export function ChannelsPage() {
	const { request, error, busy } = useIntegrations();
	const [channels, setChannels] = useState<readonly ChannelView[]>([]);
	const [selected, setSelected] = useState<ChannelDescriptor>();
	const refresh = useCallback(async () => {
		const reply = await request({ type: "channels.list" });
		if (reply?.type === "channels") setChannels(reply.channels);
	}, [request]);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	const connected = channels.filter((c) => c.configured);
	return (
		<section className="mc-panel" aria-label="Channel Configuration">
			<header className="mc-toolbar">
				<div>
					<h2>Channel Configuration</h2>
					<p>{s.hub.heroCn}</p>
					<p>{s.hub.heroIntl}</p>
				</div>
				<button
					className="mc-button"
					type="button"
					disabled={busy}
					onClick={() => void refresh()}
				>
					Refresh
				</button>
			</header>
			{error && <p role="alert">{error}</p>}
			{!channels.length && busy && <p role="status">{s.hub.loading}</p>}
			<section
				aria-label={s.hub.connectedTitle.replace(
					"{count}",
					String(connected.length),
				)}
			>
				<h3>
					{s.hub.connectedTitle.replace("{count}", String(connected.length))}
				</h3>
				{connected.map((channel) => {
					const descriptor = CHANNEL_CATALOG.find((d) => d.id === channel.id);
					return (
						<div className="mc-toolbar" key={channel.id}>
							<span
								aria-hidden="true"
								style={{
									width: 10,
									height: 10,
									borderRadius: "50%",
									background: !channel.enabled
										? "#f59e0b"
										: channel.state === "Connected"
											? "#67c23a"
											: "#666",
									display: "inline-block",
								}}
							/>
							<strong>{descriptor?.name}</strong>
							<span className="mc-badge">{channel.state}</span>
							<button
								className="mc-button"
								type="button"
								onClick={() => setSelected(descriptor)}
							>
								{s.hub.manage}
							</button>
							<label>
								<input
									type="checkbox"
									checked={channel.enabled}
									disabled={busy}
									onChange={async (event) => {
										const reply = await request({
											type: "channels.enable",
											id: channel.id,
											enabled: event.target.checked,
										});
										if (reply?.type === "channels") setChannels(reply.channels);
									}}
								/>
								Enabled
							</label>
							<button
								className="mc-button"
								type="button"
								disabled={busy}
								onClick={async () => {
									if (
										!window.confirm(
											channelDeleteConfirm.replace(
												"{name}",
												descriptor?.name ?? channel.id,
											),
										)
									)
										return;
									const reply = await request({
										type: "channels.remove",
										id: channel.id,
									});
									if (reply?.type === "channels") setChannels(reply.channels);
								}}
							>
								Delete
							</button>
						</div>
					);
				})}
			</section>
			{(["China", "International"] as const).map((region) => (
				<section key={region} aria-label={region}>
					<h3>{region}</h3>
					<div className="mc-grid mc-channel-grid">
						{CHANNEL_CATALOG.filter((d) => d.region === region).map(
							(descriptor) => {
								const channel = channels.find((c) => c.id === descriptor.id);
								const state = channel?.state ?? "Not configured";
								return (
									<article className="mc-card" key={descriptor.id}>
										<header className="mc-toolbar">
											<span aria-hidden="true">{descriptor.icon}</span>
											<h4>{descriptor.name}</h4>
											<span className="mc-badge">{state}</span>
										</header>
										<p>{descriptor.source}</p>
										<p>{descriptor.blurb}</p>
										<p>{descriptor.eta}</p>
										{state === "Unavailable" && (
											<p role="status">{channel?.reason}</p>
										)}
										<div className="mc-toolbar">
											<button
												className="mc-button"
												data-primary
												type="button"
												aria-label={`${channel?.configured ? s.hub.manage : s.hub.connect} ${descriptor.name}`}
												disabled={
													busy ||
													(descriptor.setupType === "qr_login" &&
														state === "Unavailable")
												}
												onClick={() => setSelected(descriptor)}
											>
												{channel?.configured ? s.hub.manage : s.hub.connect}
											</button>
											{descriptor.platformUrl && (
												<button
													className="mc-button"
													type="button"
													onClick={() =>
														void request({
															type: "channels.portal",
															id: descriptor.id,
														})
													}
												>
													{s.hub.openPlatform}
												</button>
											)}
										</div>
									</article>
								);
							},
						)}
					</div>
				</section>
			))}
			{selected && (
				<ChannelSetupDrawer
					descriptor={selected}
					configured={channels.find((c) => c.id === selected.id)}
					onClose={() => {
						setSelected(undefined);
						void refresh();
					}}
				/>
			)}
		</section>
	);
}
