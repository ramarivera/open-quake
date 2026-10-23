import { Schema } from "effect";
import { useState } from "react";
import { FillMode, HourFormat } from "../../../shared/display";
import { useWallpaper } from "./useWallpaper";
import { WallpaperCanvas } from "./WallpaperCanvas";

export function WallpaperPanel(): React.JSX.Element {
	const { snapshot } = useWallpaper();
	return (
		<main className="wallpaper-panel" aria-label="Quake device panel">
			<WallpaperCanvas snapshot={snapshot} />
		</main>
	);
}

export function WallpaperSettings(): React.JSX.Element {
	const { snapshot, notice, busy, request } = useWallpaper();
	const [serial, setSerial] = useState("");
	const saved = snapshot?.saved;
	const selection = saved
		? { serial: saved.serial, revision: saved.revision }
		: undefined;
	const disabled = busy || !selection;
	const configure = (fillMode: FillMode, hourFormat: HourFormat): void => {
		if (selection)
			void request({ _tag: "configure", ...selection, fillMode, hourFormat });
	};
	return (
		<section
			className="wallpaper-settings"
			aria-labelledby="wallpaper-heading"
			aria-busy={busy}
		>
			<h2 id="wallpaper-heading">Panel wallpaper</h2>
			<p className="muted">
				One local JPEG or PNG, saved for each device serial. The preview uses
				the panel's 1920 × 480 canvas.
			</p>
			<form
				className="wallpaper-serial"
				onSubmit={(event) => {
					event.preventDefault();
					if (serial.trim())
						void request({ _tag: "select", serial: serial.trim() });
				}}
			>
				<label className="setting">
					Device serial
					<input
						value={serial}
						placeholder={saved?.serial ?? "Enter device serial"}
						onChange={(event) => setSerial(event.target.value)}
						disabled={busy}
					/>
				</label>
				<button type="submit" disabled={busy || !serial.trim()}>
					Load device settings
				</button>
			</form>
			<p className="muted">
				{saved?.serial === "desktop-preview"
					? "Desktop preview session. Enter a device serial to keep its settings separately."
					: saved
						? `Editing ${saved.serial} · revision ${saved.revision}`
						: "Loading saved wallpaper…"}
			</p>
			<div className="wallpaper-preview">
				<WallpaperCanvas snapshot={snapshot} />
			</div>
			<div className="settings-row">
				<label className="setting">
					Image fit
					<select
						value={saved?.settings.bgFillMode ?? "cover"}
						disabled={disabled}
						onChange={(event) => {
							if (Schema.is(FillMode)(event.target.value))
								configure(
									event.target.value,
									saved?.clock.actions[0].value ?? "24h",
								);
						}}
					>
						<option value="contain">Contain · show whole image</option>
						<option value="cover">Cover · fill and crop</option>
						<option value="center">Center · original size</option>
					</select>
				</label>
				<label className="setting">
					Clock format
					<select
						value={saved?.clock.actions[0].value ?? "24h"}
						disabled={disabled}
						onChange={(event) => {
							if (Schema.is(HourFormat)(event.target.value))
								configure(
									saved?.settings.bgFillMode ?? "cover",
									event.target.value,
								);
						}}
					>
						<option value="24h">24 hour</option>
						<option value="12h">12 hour · AM / PM</option>
					</select>
				</label>
			</div>
			<div className="wallpaper-actions">
				<button
					type="button"
					disabled={disabled}
					onClick={() => {
						if (selection) void request({ _tag: "import", ...selection });
					}}
				>
					Choose image…
				</button>
				<button
					type="button"
					disabled={disabled || !saved?.settings.displayMediaList.length}
					onClick={() => {
						if (selection) void request({ _tag: "clear", ...selection });
					}}
				>
					Use neutral background
				</button>
				<button
					type="button"
					disabled={disabled || saved?.revision === 0}
					onClick={() => {
						if (selection) void request({ _tag: "restore", ...selection });
					}}
				>
					Restore previous revision
				</button>
			</div>
			<div role="status" aria-live="polite" className="wallpaper-status">
				<p>
					{snapshot?.asset._tag === "ready"
						? `Desktop rendered: ${saved?.settings.displayMediaList[0]?.name}`
						: snapshot?.asset._tag === "unreadable"
							? "Saved image is unreadable. Choose the image again or use the neutral background."
							: "Neutral background. Choose an image to add wallpaper."}
				</p>
				<p className="muted">
					Device delivery: unverified. Desktop rendering does not confirm
					hardware delivery.
				</p>
				{snapshot?.recovered ? (
					<p className="notice">
						Recovered the previous settings backup. Save a change to create a
						new revision.
					</p>
				) : null}
				{snapshot?.normalizedFileUrl ? (
					<p className="notice">
						Imported file URL as an app-managed image reference.
					</p>
				) : null}
				{notice ? <p className="notice">{notice}</p> : null}
			</div>
		</section>
	);
}
