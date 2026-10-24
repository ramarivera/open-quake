import { useId, useState } from "react";
import type { FillMode, HourFormat } from "../../../shared/display";
import { PanelFeedbackLayer } from "../panel/PanelFeedbackLayer";
import { usePanelFeedback } from "../panel/usePanelFeedback";
import { DeviceScreen } from "../ui/DeviceScreen";
import {
	Callout,
	Group,
	PageHeader,
	Row,
	Segmented,
	type SegmentOption,
} from "../ui/Form";
import { useQuakeEvents } from "../useQuakeEvents";
import { useWallpaper } from "./useWallpaper";
import { WallpaperCanvas } from "./WallpaperCanvas";

export function WallpaperPanel(): React.JSX.Element {
	const { snapshot } = useWallpaper();
	const feedback = usePanelFeedback(useQuakeEvents());
	return (
		<main className="wallpaper-panel" aria-label="Quake device panel">
			<WallpaperCanvas snapshot={snapshot}>
				<PanelFeedbackLayer view={feedback} />
			</WallpaperCanvas>
		</main>
	);
}

export type WallpaperController = ReturnType<typeof useWallpaper>;

const fillOptions: ReadonlyArray<SegmentOption<FillMode>> = [
	{ value: "cover", label: "Fill" },
	{ value: "contain", label: "Fit" },
	{ value: "center", label: "Center" },
];
const fillHints: Readonly<Record<FillMode, string>> = {
	cover: "Fills the screen and crops the edges.",
	contain: "Shows the whole image.",
	center: "Original size, centered.",
};
const hourOptions: ReadonlyArray<SegmentOption<HourFormat>> = [
	{ value: "24h", label: "24-hour" },
	{ value: "12h", label: "12-hour" },
];

/** Management view. The controller is shared with the overview preview. */
export function WallpaperSettings({
	wallpaper,
}: {
	wallpaper: WallpaperController;
}): React.JSX.Element {
	const { snapshot, notice, busy, request } = wallpaper;
	const [serial, setSerial] = useState("");
	const ids = useId();
	const saved = snapshot?.saved;
	const selection = saved
		? { serial: saved.serial, revision: saved.revision }
		: undefined;
	const disabled = busy || !selection;
	const fillMode = saved?.settings.bgFillMode ?? "cover";
	const hourFormat = saved?.clock.actions[0].value ?? "24h";
	const image = saved?.settings.displayMediaList[0];
	const previewSession = saved?.serial === "desktop-preview";
	const configure = (fill: FillMode, hours: HourFormat): void => {
		if (selection)
			void request({
				_tag: "configure",
				...selection,
				fillMode: fill,
				hourFormat: hours,
			});
	};
	return (
		<div className="page" aria-busy={busy}>
			<PageHeader
				title="Screen"
				description="Wallpaper and clock for the QUAKE's 1920 × 480 display."
			/>
			<DeviceScreen snapshot={snapshot} size="large" />

			<Group
				title="Wallpaper"
				description="One local JPEG or PNG, saved for each device."
				footer={
					<div role="status" aria-live="polite" className="status-notes">
						{snapshot?.asset._tag === "unreadable" ? (
							<Callout tone="warning">
								The saved image can't be read. Choose it again or remove it.
							</Callout>
						) : null}
						{snapshot?.recovered ? (
							<Callout tone="warning">
								Recovered the previous settings backup. Save a change to create
								a new revision.
							</Callout>
						) : null}
						{snapshot?.normalizedFileUrl ? (
							<Callout>
								Imported the file URL as an app-managed image reference.
							</Callout>
						) : null}
						{notice ? <Callout tone="warning">{notice}</Callout> : null}
						<p>
							The preview matches what the panel window draws. Delivery to the
							QUAKE hardware itself isn't verified yet.
						</p>
					</div>
				}
			>
				<Row
					label="Image"
					hint={
						<span aria-live="polite">
							{!snapshot
								? "Loading saved wallpaper…"
								: snapshot.asset._tag === "ready"
									? (image?.name ?? "Custom image")
									: snapshot.asset._tag === "unreadable"
										? "Unreadable image"
										: "None · neutral background"}
						</span>
					}
				>
					<div className="button-row">
						<button
							type="button"
							className="button"
							disabled={disabled}
							onClick={() => {
								if (selection) void request({ _tag: "import", ...selection });
							}}
						>
							Choose Image…
						</button>
						<button
							type="button"
							className="button"
							disabled={disabled || !image}
							onClick={() => {
								if (selection) void request({ _tag: "clear", ...selection });
							}}
						>
							Remove
						</button>
					</div>
				</Row>
				<Row label="Fit" labelId={`${ids}-fit`} hint={fillHints[fillMode]}>
					<Segmented
						name={`${ids}-fit`}
						labelledBy={`${ids}-fit`}
						value={fillMode}
						options={fillOptions}
						disabled={disabled}
						onChange={(fill) => configure(fill, hourFormat)}
					/>
				</Row>
			</Group>

			<Group title="Clock">
				<Row label="Time format" labelId={`${ids}-clock`}>
					<Segmented
						name={`${ids}-clock`}
						labelledBy={`${ids}-clock`}
						value={hourFormat}
						options={hourOptions}
						disabled={disabled}
						onChange={(hours) => configure(fillMode, hours)}
					/>
				</Row>
			</Group>

			<Group
				title="Device profile"
				description="Screen settings are kept separately for each device serial."
			>
				<Row
					label="Editing"
					hint={
						!saved
							? "Loading…"
							: previewSession
								? "Desktop preview session. Load a serial to keep its settings separately."
								: `Revision ${saved.revision}`
					}
				>
					{previewSession ? (
						<span className="value nowrap">Desktop preview</span>
					) : (
						<span className="value mono">{saved?.serial ?? "—"}</span>
					)}
				</Row>
				<form
					className="row"
					onSubmit={(event) => {
						event.preventDefault();
						if (serial.trim())
							void request({ _tag: "select", serial: serial.trim() });
					}}
				>
					<div className="row-label">
						<label htmlFor={`${ids}-serial`}>Device serial</label>
					</div>
					<div className="row-control">
						<input
							id={`${ids}-serial`}
							className="text-field mono"
							value={serial}
							placeholder={
								saved && !previewSession ? saved.serial : "Serial number"
							}
							onChange={(event) => setSerial(event.target.value)}
							disabled={busy}
							spellCheck={false}
							autoComplete="off"
						/>
						<button
							type="submit"
							className="button"
							disabled={busy || !serial.trim()}
						>
							Load
						</button>
					</div>
				</form>
				<Row label="History" hint="Every change saves a new revision.">
					<button
						type="button"
						className="button"
						disabled={disabled || saved?.revision === 0}
						onClick={() => {
							if (selection) void request({ _tag: "restore", ...selection });
						}}
					>
						Restore Previous
					</button>
				</Row>
			</Group>
		</div>
	);
}
