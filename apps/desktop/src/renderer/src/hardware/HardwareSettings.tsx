import { Either, Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type HardwareRequest,
	HardwareResponse,
	type HardwareSnapshot,
	luminancePercent,
	sliderToVolume,
	volumeToSlider,
} from "../../../shared/hardware-contracts";
import { Group, PageHeader, Row } from "../ui/Form";
import "./hardware.css";

// Recovered locale-en.json: version, settings.knobLEDAlwaysOn, settings.buzzerAlertVolume,
// mic, luminance, buzzer, settings.firmwareUpgrade.rowStatus.deviceOffline.
export function HardwareSettings(): React.JSX.Element {
	const [snapshot, setSnapshot] = useState<HardwareSnapshot>();
	const [mock, setMock] = useState(false);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [desiredVolume, setDesiredVolume] = useState<{
		session: string;
		volume: number;
	}>();
	const queuedVolume = useRef<{ session: string; volume: number } | undefined>(
		undefined,
	);
	const currentSnapshot = useRef<HardwareSnapshot | undefined>(undefined);
	const sequence = useRef(0);
	const pending = useRef(false);
	const mounted = useRef(true);
	const request = useCallback(async (input: HardwareRequest): Promise<void> => {
		const bridge = window.quakeHardware;
		if (!bridge) {
			setLoading(false);
			return;
		}
		const id = ++sequence.current;
		try {
			const value = await bridge.request(input);
			if (!mounted.current || id !== sequence.current) return;
			const decoded = Schema.decodeUnknownEither(HardwareResponse)(value);
			if (Either.isLeft(decoded)) {
				setError("Device response could not be read.");
				return;
			}
			const reply = decoded.right;
			if (reply._tag === "ready") {
				currentSnapshot.current = reply.snapshot;
				setSnapshot(reply.snapshot);
				setMock(reply.mock);
				setError("");
			} else if (reply._tag === "offline") {
				currentSnapshot.current = undefined;
				setSnapshot(undefined);
			} else
				setError(
					`Device control failed (${reply.code}). Reconnect the device and try again.`,
				);
		} catch {
			if (mounted.current && id === sequence.current)
				setError("Device controls could not be reached. Try again.");
		} finally {
			if (mounted.current && id === sequence.current) setLoading(false);
		}
	}, []);
	useEffect(() => {
		mounted.current = true;
		void request({ _tag: "read" });
		const timer = setInterval(() => {
			if (!pending.current) void request({ _tag: "read" });
		}, 500);
		return () => {
			mounted.current = false;
			sequence.current++;
			queuedVolume.current = undefined;
			clearInterval(timer);
		};
	}, [request]);
	const change = async (input: HardwareRequest): Promise<void> => {
		if (pending.current) return;
		pending.current = true;
		setBusy(true);
		setError("");
		let command = input;
		while (mounted.current) {
			await request(command);
			const queued = queuedVolume.current;
			queuedVolume.current = undefined;
			const current = currentSnapshot.current;
			if (!queued || !current?.available || queued.session !== current.session)
				break;
			command = {
				_tag: "configure",
				session: current.session,
				preferences: { ...current.preferences, alertVolume: queued.volume },
			};
		}
		pending.current = false;
		if (mounted.current) {
			setDesiredVolume(undefined);
			setBusy(false);
		}
	};
	const prefs = snapshot?.preferences;
	const session = snapshot?.session ?? "";
	const volume =
		desiredVolume?.session === session
			? desiredVolume.volume
			: (prefs?.alertVolume ?? 84);
	const changeVolume = (position: number): void => {
		if (!snapshot?.available) return;
		const next = { session, volume: sliderToVolume(position) };
		setDesiredVolume(next);
		if (pending.current) queuedVolume.current = next;
		else
			void change({
				_tag: "configure",
				session,
				preferences: { ...snapshot.preferences, alertVolume: next.volume },
			});
	};
	const disabled = busy || !snapshot?.available;
	const configure = (preferences: NonNullable<typeof prefs>) =>
		change({ _tag: "configure", session, preferences });
	return (
		<div className="page hardware-settings">
			<PageHeader
				title="Device controls"
				description={
					<span role="status">
						{loading
							? "Loading device…"
							: snapshot
								? `${snapshot.serial}${mock ? " · Mock device" : ""}`
								: "Device not connected"}
					</span>
				}
			>
				<button
					className="button"
					type="button"
					disabled={disabled}
					onClick={() => void change({ _tag: "refresh", session })}
				>
					Refresh
				</button>
			</PageHeader>
			<Group title="Device">
				<Row label="Firmware Version">
					<output className="value mono" data-testid="hardware-firmware">
						{snapshot?.firmware
							? `${snapshot.firmware.major}.${snapshot.firmware.minor}.${snapshot.firmware.patch}`
							: "--"}
					</output>
				</Row>
				<Row label="Device Mic" htmlFor="device-mic">
					<button
						className="button"
						id="device-mic"
						type="button"
						aria-pressed={snapshot?.mic}
						disabled={disabled || snapshot?.mic === undefined}
						onClick={() => void change({ _tag: "toggleMic", session })}
					>
						{snapshot?.mic === undefined ? "--" : snapshot.mic ? "On" : "Off"}
					</button>
				</Row>
				<Row label="Device Luminance">
					<div className="hardware-stepper">
						<button
							className="button"
							type="button"
							aria-label="Decrease Device Luminance"
							disabled={
								disabled ||
								snapshot?.luminance === undefined ||
								snapshot.luminance <= 25
							}
							onClick={() =>
								void change({ _tag: "stepBrightness", session, direction: -1 })
							}
						>
							−
						</button>
						<output>
							{snapshot?.luminance === undefined
								? "--"
								: `${luminancePercent(snapshot.luminance)}%`}
						</output>
						<button
							className="button"
							type="button"
							aria-label="Increase Device Luminance"
							disabled={
								disabled ||
								snapshot?.luminance === undefined ||
								snapshot.luminance >= 255
							}
							onClick={() =>
								void change({ _tag: "stepBrightness", session, direction: 1 })
							}
						>
							+
						</button>
					</div>
				</Row>
			</Group>
			<Group title="Feedback">
				<Row
					label="Knob LED stays on"
					htmlFor="knob-led"
					hint="Keep the knob lit while your computer is locked."
				>
					<input
						id="knob-led"
						type="checkbox"
						disabled={disabled}
						checked={prefs?.knobLedAlwaysOn ?? true}
						onChange={(e) => {
							if (prefs)
								void configure({ ...prefs, knobLedAlwaysOn: e.target.checked });
						}}
					/>
				</Row>
				<Row label="Buzzer" htmlFor="buzzer-enabled">
					<input
						id="buzzer-enabled"
						type="checkbox"
						disabled={disabled}
						checked={prefs?.buzzerEnabled ?? true}
						onChange={(e) => {
							if (prefs)
								void configure({ ...prefs, buzzerEnabled: e.target.checked });
						}}
					/>
				</Row>
				<Row label="Device Alert Volume" htmlFor="alert-volume">
					<div className="hardware-slider">
						<input
							id="alert-volume"
							type="range"
							min="0"
							max="96"
							step="1"
							disabled={!snapshot?.available}
							value={volumeToSlider(volume)}
							aria-valuetext={volume === 0 ? "Silent" : String(volume)}
							onChange={(e) => changeVolume(Number(e.target.value))}
						/>
						<output htmlFor="alert-volume">
							{volume === 0 ? "X" : volume}
						</output>
					</div>
				</Row>
			</Group>
			<Group title="Keyboard">
				<Row
					label="Hotkey output"
					htmlFor="hotkey-route"
					hint="Device keyboard sends shortcuts through QUAKE. Host keyboard is unavailable in this build."
				>
					<select
						className="text-field"
						id="hotkey-route"
						disabled={disabled}
						value={snapshot?.inputMode ?? "device"}
						onChange={(e) => {
							if (e.target.value === "device" || e.target.value === "host")
								void change({
									_tag: "inputMode",
									session,
									mode: e.target.value,
								});
						}}
					>
						<option value="device">Device keyboard</option>
						<option value="host" disabled>
							Host keyboard unavailable
						</option>
					</select>
				</Row>
			</Group>
			<div className="hardware-notices">
				{snapshot?.preferenceStatus === "pending" && (
					<p className="muted" role="status">
						Saving…
					</p>
				)}
				{snapshot?.preferenceStatus === "failed" && (
					<p role="alert">
						Device preferences could not be saved. Change the setting to retry.
					</p>
				)}
				{snapshot && !snapshot.available && (
					<p role="alert">
						Device controls are unavailable. Reconnect the device.
					</p>
				)}
				{snapshot?.errorCode && (
					<p role="alert">Device control failed ({snapshot.errorCode}).</p>
				)}
				{error && <p role="alert">{error}</p>}
			</div>
		</div>
	);
}
