import { Schema } from "effect";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
	type DeviceChoiceRequest,
	DeviceChoices,
} from "../../../shared/management";
import { useAppLocale } from "../i18n";

/** A serial selection never follows input activity on a different attached device. */
export function DevicePicker({ children }: { readonly children: ReactNode }) {
	const [choices, setChoices] = useState<typeof DeviceChoices.Type>();
	const [error, setError] = useState(false);
	const [busy, setBusy] = useState(false);
	const sequence = useRef(0);
	const pending = useRef(false);
	const { locale } = useAppLocale();
	const german = locale === "de";
	useEffect(() => {
		let live = true;
		const refresh = async () => {
			if (pending.current) return;
			const id = ++sequence.current;
			try {
				const reply = await window.quakeManagement?.devices?.({
					action: "read",
				});
				if (!live || id !== sequence.current) return;
				const result = Schema.decodeUnknownOption(DeviceChoices)(reply);
				if (result._tag === "Some") {
					setChoices(result.value);
					setError(false);
				} else if (window.quakeManagement?.devices) setError(true);
			} catch {
				if (live && id === sequence.current) setError(true);
			}
		};
		void refresh();
		window.addEventListener("focus", refresh);
		const timer = setInterval(() => void refresh(), 1000);
		return () => {
			live = false;
			sequence.current++;
			window.removeEventListener("focus", refresh);
			clearInterval(timer);
		};
	}, []);
	const select = async (serial: string) => {
		const device = choices?.devices.find((device) => device.serial === serial);
		if (!device || pending.current) return;
		pending.current = true;
		setBusy(true);
		const id = ++sequence.current;
		try {
			const input: typeof DeviceChoiceRequest.Type = {
				action: "select",
				device,
			};
			const result = Schema.decodeUnknownOption(DeviceChoices)(
				await window.quakeManagement?.devices?.(input),
			);
			if (id !== sequence.current) return;
			if (result._tag === "Some") {
				setChoices(result.value);
				setError(false);
			} else setError(true);
		} catch {
			if (id === sequence.current) setError(true);
		} finally {
			pending.current = false;
			if (id === sequence.current) setBusy(false);
		}
	};
	return (
		<>
			{window.quakeManagement?.devices ? (
				<label className="shell-device-picker">
					{german ? "Gerätename" : "Device name"}
					<select
						aria-label={german ? "Gerätename" : "Device name"}
						disabled={busy || !choices?.devices.length}
						value={choices?.selected ?? ""}
						onChange={(event) => void select(event.target.value)}
					>
						{!choices?.selected ? (
							<option value="">
								{german ? "Gerät nicht verbunden" : "Device not connected"}
							</option>
						) : null}
						{choices?.selected &&
						!choices.devices.some(
							(device) => device.serial === choices.selected,
						) ? (
							<option value={choices.selected}>
								{choices.selected} ·{" "}
								{german ? "Nicht verbunden" : "Disconnected"}
							</option>
						) : null}
						{choices?.devices.map((device) => (
							<option key={device.serial} value={device.serial}>
								QUAKE · {device.serial}
							</option>
						))}
					</select>
				</label>
			) : null}
			{error ? (
				<p role="alert">
					{german
						? "Geräteliste konnte nicht aktualisiert werden."
						: "Device selection could not be refreshed."}
				</p>
			) : null}
			<div
				key={`${choices?.selected ?? "default"}:${choices?.devices.find((device) => device.serial === choices.selected)?.session ?? "offline"}`}
			>
				{children}
			</div>
		</>
	);
}
