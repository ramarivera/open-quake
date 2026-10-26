import { useCallback, useEffect, useState } from "react";
import { obsCommandFromKey } from "../../../../../../packages/device/src/actions/obs-contracts";
import type { ProfileKey } from "../../../../../../packages/device/src/profiles/profile-contracts";
import type { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts";
import type {
	ObsCatalog,
	ObsStatus,
} from "../../../../../../packages/edge/src/obs/obs-contracts";
import type { ObsRequest } from "../../../shared/obs";
import { Row } from "../ui/Form";
import { obsText } from "./strings";
import "./obs.css";

const emptyCatalog: ObsCatalog = {
	scenes: [],
	inputs: [],
	transitions: [],
	items: [],
};
export function ObsSettings({
	keyValue,
	locale,
	onChange,
}: {
	readonly keyValue: ProfileKey;
	readonly locale: ProfileLocale;
	readonly onChange: (key: ProfileKey) => void;
}): React.JSX.Element {
	const [status, setStatus] = useState<ObsStatus>();
	const [host, setHost] = useState("127.0.0.1"),
		[port, setPort] = useState(4455),
		[password, setPassword] = useState("");
	const [passwordEdited, setPasswordEdited] = useState(false),
		[autoConnect, setAutoConnect] = useState(true);
	const [error, setError] = useState(""),
		[busy, setBusy] = useState(false),
		[expanded, setExpanded] = useState(false);
	const [catalog, setCatalog] = useState<ObsCatalog>(emptyCatalog);
	const text = useCallback(
		(key: string) => obsText(locale, "config", key),
		[locale],
	);
	const decoded = obsCommandFromKey(keyValue);
	let settings: Readonly<Record<string, unknown>> = {};
	try {
		const value: unknown = JSON.parse(
			String(keyValue.config.actions[0]?.value ?? "{}"),
		);
		if (value && typeof value === "object" && !Array.isArray(value))
			settings = Object.fromEntries(Object.entries(value));
	} catch {
		/* Incomplete drafts remain editable. */
	}
	const field = (name: string): string =>
		typeof settings[name] === "string" || typeof settings[name] === "number"
			? String(settings[name])
			: "";
	const update = (changes: Readonly<Record<string, unknown>>) =>
		onChange({
			...keyValue,
			config: {
				...keyValue.config,
				actions: [
					{
						type: "configData",
						value: JSON.stringify({ ...settings, ...changes }),
					},
				],
			},
		});
	useEffect(() => {
		const bridge = window.quakeObs;
		if (!bridge) return;
		let active = true;
		const apply = async () => {
			const reply = await bridge.request({ type: "status" });
			if (!active || reply.type !== "status") return;
			setStatus(reply.status);
			setHost(reply.status.host);
			setPort(reply.status.port);
			setAutoConnect(reply.status.autoConnect);
			if (reply.status.state !== "connected") {
				const connected = await bridge.request({ type: "connect" });
				if (active && connected.type === "status") setStatus(connected.status);
				if (active && connected.type === "error") {
					setError(connected.message);
					setExpanded(true);
				}
			}
		};
		void apply().catch(() => {
			if (active)
				setError(
					text("connectFailed").replace("{reason}", text("disconnected")),
				);
		});
		const dialog = setTimeout(() => {
			if (active)
				void bridge
					.request({ type: "status" })
					.then((reply) => {
						if (
							active &&
							reply.type === "status" &&
							reply.status.state !== "connected"
						)
							setExpanded(true);
					})
					.catch(() => {});
		}, 2000);
		const poll = setInterval(() => {
			void bridge
				.request({ type: "status" })
				.then((reply) => {
					if (active && reply.type === "status") setStatus(reply.status);
				})
				.catch(() => {});
		}, 3000);
		return () => {
			active = false;
			clearTimeout(dialog);
			clearInterval(poll);
		};
	}, [text]);
	const sceneUuid = field("sceneUuid");
	useEffect(() => {
		if (status?.state !== "connected") return;
		let active = true;
		void window.quakeObs
			?.request({ type: "catalog", sceneUuid })
			.then((reply) => {
				if (active && reply.type === "catalog") setCatalog(reply.catalog);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [sceneUuid, status?.state]);
	const request = async (input: ObsRequest) => {
		if (!window.quakeObs || busy) return;
		setBusy(true);
		setError("");
		try {
			const reply = await window.quakeObs.request(input);
			if (reply.type === "status") {
				setStatus(reply.status);
				if (input.type === "detect") {
					setHost(reply.status.host);
					setPort(reply.status.port);
				}
			}
			if (reply.type === "error") setError(reply.message);
		} catch {
			setError(text("disconnected"));
		} finally {
			setBusy(false);
		}
	};
	const connect = async () => {
		if (!window.quakeObs || busy) return;
		setBusy(true);
		setError("");
		try {
			const saved = await window.quakeObs.request({
				type: "configure",
				config: { host, port, autoConnect },
				...(passwordEdited ? { password } : {}),
			});
			if (saved.type === "error") {
				setError(saved.message);
				return;
			}
			setPassword("");
			setPasswordEdited(false);
			const connected = await window.quakeObs.request({ type: "connect" });
			if (connected.type === "status") setStatus(connected.status);
			if (connected.type === "error") setError(connected.message);
		} catch {
			setError(text("disconnected"));
		} finally {
			setBusy(false);
		}
	};
	const type = keyValue.config.type;
	const needsScene = [
		"obsScene",
		"obsPreviewScene",
		"obsSource",
		"obsSceneTransitionOverride",
		"obsScreenshot",
	].includes(type);
	const needsInput = [
		"obsMute",
		"obsVolume",
		"obsAudioMonitor",
		"obsMedia",
	].includes(type);
	const inputChoices = catalog.inputs.filter((input) =>
		type === "obsMedia"
			? ["ffmpeg_source", "vlc_source"].includes(input.inputKind) ||
				input.inputKind.toLowerCase().includes("media")
			: input.special || input.hasAudio,
	);
	return (
		<section className="obs-connection" aria-label={text("title")}>
			<div className="obs-controls">
				<strong>{text("title")}</strong>
				<span role="status">{text(status?.state ?? "disconnected")}</span>
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					aria-expanded={expanded}
				>
					{text("connectionStatus")}
				</button>
			</div>
			{expanded && (
				<>
					<Row label={text("host")} htmlFor="obs-host">
						<input
							id="obs-host"
							value={host}
							onChange={(e) => setHost(e.target.value)}
						/>
					</Row>
					<Row label={text("port")} htmlFor="obs-port">
						<input
							id="obs-port"
							type="number"
							min={1}
							max={65535}
							value={port}
							onChange={(e) => setPort(Number(e.target.value))}
						/>
					</Row>
					<Row label={text("password")} htmlFor="obs-password">
						<input
							id="obs-password"
							type="password"
							autoComplete="new-password"
							value={password}
							placeholder={status?.passwordSet ? "••••••••" : ""}
							onChange={(e) => {
								setPassword(e.target.value);
								setPasswordEdited(true);
							}}
						/>
					</Row>
					<Row label={text("autoConnect")} htmlFor="obs-auto">
						<input
							id="obs-auto"
							type="checkbox"
							checked={autoConnect}
							onChange={(e) => setAutoConnect(e.target.checked)}
						/>
					</Row>
					<div className="obs-controls">
						<button
							type="button"
							disabled={busy}
							onClick={() => void connect()}
						>
							{text("connect")}
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => void request({ type: "disconnect" })}
						>
							{text("disconnect")}
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => void request({ type: "detect" })}
						>
							Auto-fetch
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => {
								setPassword("");
								setPasswordEdited(true);
							}}
						>
							{text("clearPassword")}
						</button>
					</div>
					{status?.manualOverride && (
						<small>{text("manualOverrideHint")}</small>
					)}
					{status?.detection === "found" && (
						<small>
							{status.code === "OBS.AUTH.FAILED"
								? text("autoDetectAuthMismatch")
								: `OBS WebSocket port ${status.port}`}
						</small>
					)}
					{status?.detection === "not-found" && (
						<small>{text("autoDetectNotFound")}</small>
					)}
					{status?.source && (
						<small className="obs-source">
							{text("autoDetectSource").replace("{path}", status.source)}
						</small>
					)}
					{status?.state !== "connected" && (
						<div className="obs-guide">
							<strong>{text("guideTitle")}</strong>
							{[1, 2, 3, 4, 5].map((i) => (
								<div key={i}>{text(`guideStep${i}`)}</div>
							))}
						</div>
					)}
				</>
			)}
			{(error || status?.code) && (
				<p role="alert" className="obs-error">
					{error ||
						(status?.code === "OBS.AUTH.FAILED"
							? text("errAuthFailed")
							: status?.code === "OBS.RPC.UNSUPPORTED"
								? text("errRpcVersion")
								: text("disconnected"))}
				</p>
			)}
			{needsScene && (
				<Row label={text("scene")} htmlFor="obs-scene">
					<select
						id="obs-scene"
						value={sceneUuid}
						onChange={(e) => {
							const scene = catalog.scenes.find(
								(entry) => entry.sceneUuid === e.target.value,
							);
							update({
								sceneUuid: e.target.value,
								...(["obsScene", "obsPreviewScene", "obsSource"].includes(type)
									? { sceneName: scene?.sceneName ?? "" }
									: {}),
								...(type === "obsScreenshot"
									? { sourceName: scene?.sceneName ?? "" }
									: {}),
								...(type === "obsSource"
									? { sceneItemId: undefined, sourceName: undefined }
									: {}),
							});
						}}
					>
						<option value="">{text("scene")}</option>
						{sceneUuid &&
							!catalog.scenes.some(
								(scene) => scene.sceneUuid === sceneUuid,
							) && (
								<option value={sceneUuid}>
									{field("sceneName") || sceneUuid}
								</option>
							)}
						{catalog.scenes.map((scene) => (
							<option key={scene.sceneUuid} value={scene.sceneUuid}>
								{scene.sceneName}
							</option>
						))}
					</select>
				</Row>
			)}
			{type === "obsSource" && (
				<Row label={text("source")} htmlFor="obs-item">
					<select
						id="obs-item"
						value={field("sceneItemId")}
						onChange={(e) =>
							update({
								sceneItemId:
									e.target.value === "" ? undefined : Number(e.target.value),
								sourceName: catalog.items.find(
									(item) => item.sceneItemId === Number(e.target.value),
								)?.sourceName,
							})
						}
					>
						<option value="">{text("source")}</option>
						{catalog.items.map((item) => (
							<option key={item.sceneItemId} value={item.sceneItemId}>
								{item.sourceName}
							</option>
						))}
					</select>
				</Row>
			)}
			{needsInput && (
				<Row label={text("input")} htmlFor="obs-input">
					<select
						id="obs-input"
						value={field("inputUuid")}
						onChange={(e) =>
							update({
								inputUuid: e.target.value,
								inputName: catalog.inputs.find(
									(input) => input.inputUuid === e.target.value,
								)?.inputName,
								...(type === "obsVolume"
									? {
											step: settings.step ?? 0.05,
											allowGain: false,
											pressAction: "mute",
										}
									: {}),
								...(type === "obsMedia"
									? {
											mediaAction:
												settings.mediaAction ??
												"OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY",
										}
									: {}),
								...(type === "obsAudioMonitor"
									? { monitorType: settings.monitorType ?? "monitorOff" }
									: {}),
							})
						}
					>
						<option value="">{text("input")}</option>
						{field("inputUuid") &&
							!inputChoices.some(
								(input) => input.inputUuid === field("inputUuid"),
							) && (
								<option value={field("inputUuid")}>
									{field("inputName") || field("inputUuid")}
								</option>
							)}
						{inputChoices.map((input) => (
							<option key={input.inputUuid} value={input.inputUuid}>
								{input.inputName}
							</option>
						))}
					</select>
				</Row>
			)}
			{type === "obsVolume" && (
				<Row label={`${text("step")} %`} htmlFor="obs-step">
					<input
						id="obs-step"
						type="number"
						min={1}
						max={20}
						value={Number(settings.step ?? 0.05) * 100}
						onChange={(e) =>
							update({
								step: Number(e.target.value) / 100,
								allowGain: false,
								pressAction: "mute",
							})
						}
					/>
				</Row>
			)}
			{["obsTransitionSet", "obsSceneTransitionOverride"].includes(type) && (
				<>
					<Row label={text("transition")} htmlFor="obs-transition">
						<select
							id="obs-transition"
							value={field("transitionName")}
							onChange={(e) =>
								update({
									transitionName: e.target.value,
									durationMs: settings.durationMs ?? 300,
								})
							}
						>
							<option value="">{text("transition")}</option>
							{catalog.transitions.map((transition) => (
								<option key={transition.transitionName}>
									{transition.transitionName}
								</option>
							))}
						</select>
					</Row>
					<Row label={text("duration")} htmlFor="obs-duration">
						<input
							id="obs-duration"
							type="number"
							min={50}
							max={20000}
							step={100}
							value={Number(settings.durationMs ?? 300)}
							onChange={(e) => update({ durationMs: Number(e.target.value) })}
						/>
					</Row>
				</>
			)}
			{type === "obsAudioMonitor" && (
				<Row label={text("monitorType")} htmlFor="obs-monitor">
					<select
						id="obs-monitor"
						value={field("monitorType") || "monitorOff"}
						onChange={(e) => update({ monitorType: e.target.value })}
					>
						<option value="monitorOff">Off</option>
						<option value="monitorOnly">Monitor Only</option>
						<option value="monitorAndOutput">Monitor + Output</option>
					</select>
				</Row>
			)}
			{type === "obsReplayBuffer" && (
				<Row label={text("action")} htmlFor="obs-replay">
					<select
						id="obs-replay"
						value={field("action") || "toggle"}
						onChange={(e) => update({ action: e.target.value })}
					>
						{["toggle", "save", "start", "stop"].map((action) => (
							<option key={action}>{action}</option>
						))}
					</select>
				</Row>
			)}
			{type === "obsRecord" && (
				<Row label={text("action")} htmlFor="obs-record">
					<select
						id="obs-record"
						value={field("mode") || "toggle"}
						onChange={(e) => update({ mode: e.target.value })}
					>
						<option value="toggle">Toggle</option>
						<option value="pause">Pause</option>
					</select>
				</Row>
			)}
			{type === "obsMedia" && (
				<Row label={text("action")} htmlFor="obs-media">
					<select
						id="obs-media"
						value={
							field("mediaAction") || "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY"
						}
						onChange={(e) => update({ mediaAction: e.target.value })}
					>
						{["PLAY", "PAUSE", "STOP", "RESTART", "NEXT", "PREVIOUS"].map(
							(action) => (
								<option
									key={action}
									value={`OBS_WEBSOCKET_MEDIA_INPUT_ACTION_${action}`}
								>
									{action}
								</option>
							),
						)}
					</select>
				</Row>
			)}
			{type === "obsFilter" && (
				<>
					{["sourceName", "filterName"].map((name) => (
						<Row
							key={name}
							label={text(name === "sourceName" ? "source" : "filter")}
							htmlFor={`obs-${name}`}
						>
							<input
								id={`obs-${name}`}
								value={field(name)}
								onChange={(e) =>
									update({
										[name]: e.target.value,
										filterEnabled: settings.filterEnabled ?? true,
									})
								}
							/>
						</Row>
					))}
					<Row label={text("enable")} htmlFor="obs-filter">
						<input
							id="obs-filter"
							type="checkbox"
							checked={settings.filterEnabled !== false}
							onChange={(e) => update({ filterEnabled: e.target.checked })}
						/>
					</Row>
				</>
			)}
			{type === "obsProfile" && (
				<>
					<Row label={text("kind")} htmlFor="obs-kind">
						<select
							id="obs-kind"
							value={field("kind") || "profile"}
							onChange={(e) => update({ kind: e.target.value })}
						>
							<option value="profile">Profile</option>
							<option value="sceneCollection">Scene Collection</option>
						</select>
					</Row>
					<Row label={text("name")} htmlFor="obs-name">
						<input
							id="obs-name"
							value={field("name")}
							onChange={(e) =>
								update({
									name: e.target.value,
									kind: settings.kind ?? "profile",
								})
							}
						/>
					</Row>
				</>
			)}
			{decoded._tag === "Left" && (
				<small role="status">{text("chooseTarget")}</small>
			)}
		</section>
	);
}
