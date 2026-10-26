import { useId, useState } from "react";
import type { FillMode, HourFormat } from "../../../shared/display";
import { useAppTranslations } from "../i18n";
import { useStripSettings } from "../strip/stripSettings";
import { DeviceScreen } from "../ui/DeviceScreen";
import {
	Callout,
	Group,
	PageHeader,
	Row,
	Segmented,
	type SegmentOption,
} from "../ui/Form";
import type { useWallpaper } from "./useWallpaper";
import { WallpaperPlaylist } from "./WallpaperPlaylist";

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
type PreviewView = "active" | "vivid";
const previewOptions: ReadonlyArray<SegmentOption<PreviewView>> = [
	{ value: "active", label: "Key grid" },
	{ value: "vivid", label: "Vivid screen" },
];
const borderOptions: ReadonlyArray<SegmentOption<"on" | "off">> = [
	{ value: "on", label: "On" },
	{ value: "off", label: "Off" },
];
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
	const t = useAppTranslations("wallpaper");
	const [serial, setSerial] = useState("");
	const [preview, setPreview] = useState<PreviewView>("active");
	const strip = useStripSettings();
	const ids = useId();
	const saved = snapshot?.saved;
	const selection = saved
		? { serial: saved.serial, revision: saved.revision }
		: undefined;
	const disabled = busy || !selection;
	const fillMode = saved?.settings.bgFillMode ?? "cover";
	const hourFormat = saved?.clock.actions[0].value ?? "24h";
	const activeMedia =
		saved?.settings.displayMediaList[snapshot?.activeIndex ?? 0];
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
				description="Key grid, wallpaper and clock for the QUAKE's 1920 × 480 display."
			>
				<Segmented
					name={`${ids}-preview`}
					labelledBy={`${ids}-preview-label`}
					value={preview}
					options={previewOptions}
					onChange={setPreview}
				/>
				<span id={`${ids}-preview-label`} className="visually-hidden">
					Preview
				</span>
			</PageHeader>
			<DeviceScreen snapshot={snapshot} size="large" view={preview} />

			<Group
				title="Key grid"
				description="The active profile's keys, drawn as DK-Suite draws them."
				footer={
					strip.notice ? <Callout tone="warning">{strip.notice}</Callout> : null
				}
			>
				<Row
					label="Empty Slot Dashed Border"
					labelId={`${ids}-dashed`}
					hint="Outlines empty keys on the device and in this preview."
				>
					<Segmented
						name={`${ids}-dashed`}
						labelledBy={`${ids}-dashed`}
						value={strip.settings.showEmptyGridDashedBorder ? "on" : "off"}
						options={borderOptions}
						onChange={(value) =>
							strip.setShowEmptyGridDashedBorder(value === "on")
						}
					/>
				</Row>
			</Group>

			<Group
				title="Wallpaper"
				description="Local images and videos for the vivid screen, saved in playlist order for each device."
				footer={
					<div role="status" aria-live="polite" className="status-notes">
						{snapshot?.asset._tag === "unreadable" ? (
							<Callout tone="warning">{t("savedUnreadable")}</Callout>
						) : null}
						{snapshot?.recovered ? (
							<Callout tone="warning">
								Recovered the previous settings backup. Save a change to create
								a new revision.
							</Callout>
						) : null}
						{snapshot?.normalizedFileUrl ? (
							<Callout>{t("importedUrl")}</Callout>
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
					label={t("media")}
					hint={
						<span aria-live="polite">
							{!snapshot
								? t("loading")
								: snapshot.asset._tag === "ready"
									? (activeMedia?.name ?? t("customMedia"))
									: snapshot.asset._tag === "unreadable"
										? t("unreadableMedia")
										: t("noMedia")}
						</span>
					}
				>
					<div className="button-row">
						<button
							type="button"
							className="button"
							disabled={disabled}
							onClick={() => {
								if (selection)
									void request({ _tag: "import", ...selection, append: true });
							}}
						>
							{t("addMedia")}
						</button>
						<button
							type="button"
							className="button"
							disabled={disabled || !saved?.settings.displayMediaList.length}
							onClick={() => {
								if (selection) void request({ _tag: "clear", ...selection });
							}}
						>
							{t("removeAll")}
						</button>
					</div>
				</Row>
				<WallpaperPlaylist
					items={saved?.settings.displayMediaList ?? []}
					disabled={disabled}
					move={(from, to) => {
						if (selection && from !== to)
							void request({ _tag: "reorder", ...selection, from, to });
					}}
					remove={(index) => {
						if (selection)
							void request({ _tag: "remove", ...selection, index });
					}}
				/>
				<Row
					label="Video Sound"
					labelId={`${ids}-sound`}
					hint="Sound plays only on the panel. Previews stay muted."
				>
					<Segmented
						name={`${ids}-sound`}
						labelledBy={`${ids}-sound`}
						value={saved?.settings.enableSound ? "on" : "off"}
						options={borderOptions}
						disabled={disabled}
						onChange={(value) => {
							if (selection)
								void request({
									_tag: "sound",
									...selection,
									enableSound: value === "on",
								});
						}}
					/>
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
