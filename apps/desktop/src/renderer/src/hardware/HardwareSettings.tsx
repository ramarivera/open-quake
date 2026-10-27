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
import { QmkLightingSettings } from "./QmkLightingSettings";
import { type HardwareTextKey, useHardwareText } from "./strings";
import "./hardware.css";

// Recovered locale-en.json: version, settings.knobLEDAlwaysOn, settings.buzzerAlertVolume,
// mic, luminance, buzzer, settings.firmwareUpgrade.rowStatus.deviceOffline.
export function HardwareSettings(): React.JSX.Element {
	const t = useHardwareText();
	const [snapshot, setSnapshot] = useState<HardwareSnapshot>();
	const [mock, setMock] = useState(false);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<{ key: HardwareTextKey; code?: string }>();
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
				setError({ key: "responseFailed" });
				return;
			}
			const reply = decoded.right;
			if (reply._tag === "ready") {
				currentSnapshot.current = reply.snapshot;
				setSnapshot(reply.snapshot);
				setMock(reply.mock);
				setError(undefined);
			} else if (reply._tag === "offline") {
				currentSnapshot.current = undefined;
				setSnapshot(undefined);
			} else if (reply._tag === "failure")
				setError({ key: "controlRetry", code: reply.code });
		} catch {
			if (mounted.current && id === sequence.current)
				setError({ key: "requestFailed" });
		} finally {
			if (mounted.current && id === sequence.current) setLoading(false);
		}
	}, []);
	const liveSession = useRef<string | undefined>(undefined);
	liveSession.current = snapshot?.session;
	useEffect(
		() => () => {
			const session = liveSession.current;
			if (session)
				void window.quakeHardware
					?.request({ _tag: "longTone", session, on: false })
					.catch(() => undefined);
		},
		[],
	);
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
		setError(undefined);
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
				title={t("title")}
				description={
					<span role="status">
						{loading
							? t("loading")
							: snapshot
								? `${snapshot.serial}${mock ? ` · ${t("mock")}` : ""}`
								: t("offline")}
					</span>
				}
			>
				<button
					className="button"
					type="button"
					disabled={disabled}
					onClick={() => void change({ _tag: "refresh", session })}
				>
					{t("refresh")}
				</button>
			</PageHeader>
			<QmkLightingSettings />
			<Group title={t("device")}>
				<Row label={t("firmware")}>
					<output className="value mono" data-testid="hardware-firmware">
						{snapshot?.firmware
							? `${snapshot.firmware.major}.${snapshot.firmware.minor}.${snapshot.firmware.patch}`
							: "--"}
					</output>
				</Row>
				<Row label={t("mic")} htmlFor="device-mic">
					<button
						className="button"
						id="device-mic"
						type="button"
						aria-pressed={snapshot?.mic}
						disabled={disabled || snapshot?.mic === undefined}
						onClick={() => void change({ _tag: "toggleMic", session })}
					>
						{snapshot?.mic === undefined
							? "--"
							: snapshot.mic
								? t("on")
								: t("off")}
					</button>
				</Row>
				<Row label={t("luminance")}>
					<div className="hardware-stepper">
						<button
							className="button"
							type="button"
							aria-label={t("decreaseLuminance")}
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
							aria-label={t("increaseLuminance")}
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
			<Group title={t("feedback")}>
				<Row label={t("knobLed")} htmlFor="knob-led" hint={t("knobLedHint")}>
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
				<Row label={t("buzzer")} htmlFor="buzzer-enabled">
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
				<Row label={t("buzzerTest")}>
					<button
						type="button"
						className="button"
						disabled={disabled}
						onPointerDown={() =>
							void request({ _tag: "longTone", session, on: true })
						}
						onPointerUp={() =>
							void request({ _tag: "longTone", session, on: false })
						}
						onPointerCancel={() =>
							void request({ _tag: "longTone", session, on: false })
						}
						onPointerLeave={() =>
							void request({ _tag: "longTone", session, on: false })
						}
						onKeyDown={(event) => {
							if ((event.key === " " || event.key === "Enter") && !event.repeat)
								void request({ _tag: "longTone", session, on: true });
						}}
						onKeyUp={() =>
							void request({ _tag: "longTone", session, on: false })
						}
						onBlur={() =>
							void request({ _tag: "longTone", session, on: false })
						}
					>
						{t("holdBuzzer")}
					</button>
				</Row>
				<Row label={t("alertVolume")} htmlFor="alert-volume">
					<div className="hardware-slider">
						<input
							id="alert-volume"
							type="range"
							min="0"
							max="96"
							step="1"
							disabled={!snapshot?.available}
							value={volumeToSlider(volume)}
							aria-valuetext={volume === 0 ? t("silent") : String(volume)}
							onChange={(e) => changeVolume(Number(e.target.value))}
						/>
						<output htmlFor="alert-volume">
							{volume === 0 ? "X" : volume}
						</output>
					</div>
				</Row>
			</Group>
			<Group title={t("keyboard")}>
				<Row
					label={t("hotkeyOutput")}
					htmlFor="hotkey-route"
					hint={t("hotkeyHint")}
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
						<option value="device">{t("deviceKeyboard")}</option>
						<option value="host">{t("hostKeyboard")}</option>
					</select>
				</Row>
			</Group>
			<div className="hardware-notices">
				{snapshot?.preferenceStatus === "pending" && (
					<p className="muted" role="status">
						{t("saving")}
					</p>
				)}
				{snapshot?.preferenceStatus === "failed" && (
					<p role="alert">{t("preferencesFailed")}</p>
				)}
				{snapshot && !snapshot.available && (
					<p role="alert">{t("unavailable")}</p>
				)}
				{snapshot?.errorCode && (
					<p role="alert">
						{t("controlFailed").replace("{code}", snapshot.errorCode)}
					</p>
				)}
				{error && (
					<p role="alert">{t(error.key).replace("{code}", error.code ?? "")}</p>
				)}
			</div>
		</div>
	);
}
