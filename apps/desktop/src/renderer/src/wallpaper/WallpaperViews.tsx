import { useState } from "react";
import { useAppTranslations } from "../i18n";
import { useStripSettings } from "../strip/stripSettings";
import { DeviceScreen } from "../ui/DeviceScreen";
import { PageHeader, Segmented } from "../ui/Form";
import type { useWallpaper } from "./useWallpaper";
import { WallpaperEditor } from "./WallpaperEditor";

export type WallpaperController = ReturnType<typeof useWallpaper>;

/** Both settings hosts delegate to the same serial/revision-owned editor. */
export function WallpaperSettings({
	wallpaper,
	embedded = false,
}: {
	wallpaper: WallpaperController;
	embedded?: boolean;
}): React.JSX.Element {
	const t = useAppTranslations("wallpaper");
	const [serial, setSerial] = useState("");
	const [preview, setPreview] = useState<"active" | "vivid">("active");
	const strip = useStripSettings();
	const saved = wallpaper.snapshot?.saved;
	const active =
		saved?.settings.displayMediaList[wallpaper.snapshot?.activeIndex ?? 0];
	const editor = (
		<WallpaperEditor
			key={`${saved?.serial}:${saved?.revision}`}
			wallpaper={wallpaper}
		/>
	);
	if (embedded) return editor;
	return (
		<div className="page" aria-busy={wallpaper.busy}>
			<PageHeader title="Screen" />
			<Segmented
				name="wallpaper-preview"
				labelledBy="wallpaper-preview-label"
				value={preview}
				options={[
					{ value: "active", label: "Key grid" },
					{ value: "vivid", label: "Vivid screen" },
				]}
				onChange={setPreview}
			/>
			<span id="wallpaper-preview-label" className="visually-hidden">
				Preview
			</span>
			<DeviceScreen snapshot={wallpaper.snapshot} size="large" view={preview} />
			<label>
				Empty Slot Dashed Border
				<input
					type="checkbox"
					checked={strip.settings.showEmptyGridDashedBorder}
					onChange={(event) =>
						strip.setShowEmptyGridDashedBorder(event.target.checked)
					}
				/>
			</label>
			<p>
				<span aria-live="polite">{active?.name ?? t("noMedia")}</span>
			</p>
			{editor}
			<form
				className="wallpaper-serial"
				onSubmit={(e) => {
					e.preventDefault();
					if (serial.trim())
						void wallpaper.request({ _tag: "select", serial: serial.trim() });
				}}
			>
				<label>
					Device serial
					<input
						aria-label="Device serial"
						className="text-field"
						value={serial}
						onChange={(e) => setSerial(e.target.value)}
						disabled={wallpaper.busy}
					/>
				</label>
				<button
					type="submit"
					className="button"
					disabled={wallpaper.busy || !serial.trim()}
				>
					Load
				</button>
			</form>
			<button
				type="button"
				className="button"
				disabled={!saved || saved.revision === 0 || wallpaper.busy}
				onClick={() => {
					if (saved)
						void wallpaper.request({
							_tag: "restore",
							serial: saved.serial,
							revision: saved.revision,
						});
				}}
			>
				Restore Previous
			</button>
		</div>
	);
}
