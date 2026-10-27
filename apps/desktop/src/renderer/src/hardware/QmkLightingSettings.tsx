import { Schema } from "effect";
import { useCallback, useEffect, useState } from "react";
import {
	type HardwareRequest,
	HardwareResponse,
} from "../../../shared/hardware-contracts";
import { Group, Row } from "../ui/Form";

const request = async (command: HardwareRequest) => {
	const reply = Schema.decodeUnknownSync(HardwareResponse)(
		await window.quakeHardware?.request(command),
	);
	if (reply._tag === "failure") throw new Error(reply.code);
	return reply;
};
export function QmkLightingSettings(): React.JSX.Element {
	const [targets, setTargets] = useState<
		readonly { serial: string; session: string }[]
	>([]);
	const [selected, setSelected] = useState("");
	const [version, setVersion] = useState<number>();
	const [error, setError] = useState("");
	const [lighting, setLighting] =
		useState<Extract<HardwareResponse, { _tag: "lighting" }>>();
	const [busy, setBusy] = useState(false);

	const refresh = useCallback(async () => {
		setBusy(true);
		setError("");
		try {
			const result = await request({ _tag: "qmkTargets" });
			if (result._tag === "qmkTargets") {
				setTargets(result.targets);
				setSelected((prior) =>
					result.targets.some((t) => t.session === prior)
						? prior
						: (result.targets[0]?.session ?? ""),
				);
			}
		} catch {
			setError("Failed to open DK device");
		} finally {
			setBusy(false);
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	useEffect(() => {
		let live = true;
		setVersion(undefined);
		setLighting(undefined);
		const target = targets.find((t) => t.session === selected);
		if (target)
			void request({
				_tag: "qmk",
				...target,
				operations: [{ _tag: "protocol" }],
			})
				.then((reply) => {
					if (live && reply._tag === "qmk")
						setVersion(
							(reply.values[0]?.[0] ?? 0) * 256 + (reply.values[0]?.[1] ?? 0),
						);
				})
				.catch(() => {
					if (live) setError("Failed to open DK device");
				});
		if (target)
			void request({ _tag: "lighting", ...target, action: { _tag: "select" } })
				.then((reply) => {
					if (live && reply._tag === "lighting") setLighting(reply);
				})
				.catch(() => {
					if (live) setError("Failed to open DK device");
				});
		return () => {
			live = false;
		};
	}, [selected, targets]);
	const update = async (
		action: Extract<HardwareRequest, { _tag: "lighting" }>["action"],
	) => {
		const target = targets.find((t) => t.session === selected);
		if (!target) return;
		setBusy(true);
		setError("");
		try {
			const reply = await request({ _tag: "lighting", ...target, action });
			if (reply._tag === "lighting" && reply.session === selected)
				setLighting(reply);
		} catch {
			setError("Lighting change failed. Refresh and try again.");
		} finally {
			setBusy(false);
		}
	};
	return (
		<Group title="DK device lighting">
			<Row label="DK device" htmlFor="qmk-target">
				<select
					id="qmk-target"
					value={selected}
					disabled={busy}
					onChange={(e) => setSelected(e.target.value)}
				>
					<option value="">Select QMK HID path</option>
					{targets.map((t) => (
						<option key={t.session} value={t.session}>
							QUAKE · {t.serial}
						</option>
					))}
				</select>
				<button
					type="button"
					className="button"
					disabled={busy}
					onClick={() => void refresh()}
				>
					Refresh
				</button>
			</Row>
			<Row label="Protocol Version">
				<output>{version ?? "--"}</output>
			</Row>
			{lighting?.fields
				.filter((f) => f.field === "brightness" || f.field === "effectSpeed")
				.map((field) => {
					if (field.field !== "brightness" && field.field !== "effectSpeed")
						return null;
					const value = lighting.values.find(
						(v) => v.field === field.field,
					)?.value;
					return (
						<Row
							key={field.field}
							label={
								field.field === "brightness" ? "Brightness" : "Effect speed"
							}
						>
							<input
								aria-label={
									field.field === "brightness" ? "Brightness" : "Effect speed"
								}
								type="range"
								min={field.range.min}
								max={field.range.max}
								value={typeof value === "number" ? value : 0}
								disabled={
									busy || lighting.status !== "ready" || !field.writable
								}
								onChange={(e) =>
									void update({
										_tag: "set",
										change: {
											field: field.field,
											value: Number(e.target.value),
										},
									})
								}
							/>
						</Row>
					);
				})}
			{lighting?.fields.map((field) => {
				if (field.field !== "color1" && field.field !== "color2") return null;
				const value = lighting.values.find(
					(v) => v.field === field.field,
				)?.value;
				if (typeof value !== "object") return null;
				return (
					<Row
						key={field.field}
						label={field.field === "color1" ? "Color 1" : "Color 2"}
					>
						{(["hue", "saturation"] as const).map((part) => (
							<label key={part}>
								{part}
								<input
									aria-label={`${field.field} ${part}`}
									type="range"
									min={field[part].min}
									max={field[part].max}
									value={value[part]}
									disabled={
										busy || lighting.status !== "ready" || !field.writable
									}
									onChange={(e) =>
										void update({
											_tag: "set",
											change: {
												field: field.field,
												value: { ...value, [part]: Number(e.target.value) },
											},
										})
									}
								/>
							</label>
						))}
					</Row>
				);
			})}
			{lighting?.status === "ready" && (
				<Row label="Save lighting">
					<button
						type="button"
						className="button"
						disabled={busy}
						onClick={() => void update({ _tag: "save" })}
					>
						Save
					</button>
					<output>{lighting.saveStatus}</output>
				</Row>
			)}
			{lighting?.status === "unavailable" && (
				<p role="status">No qualified lighting controls for this firmware.</p>
			)}
			{error && <p role="alert">{error}</p>}
		</Group>
	);
}
