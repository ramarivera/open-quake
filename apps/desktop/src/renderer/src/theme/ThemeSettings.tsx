import { useState } from "react";
import { isMotionPreference, isThemeSelection } from "./appearance";
import { loadCustomThemeFile } from "./customTheme";
import type { AppearanceController } from "./useAppearance";

const example = JSON.stringify(
	{ version: 1, name: "My theme", base: "dark", colors: { accent: "#b7a3ff" } },
	null,
	2,
);

export function ThemeSettings({
	controller,
}: {
	controller: AppearanceController;
}): React.JSX.Element {
	const [importMessage, setImportMessage] = useState("");
	const [loading, setLoading] = useState(false);
	const {
		appearance,
		notice,
		reducedMotion,
		setTheme,
		setMotion,
		importTheme,
	} = controller;

	return (
		<section className="appearance" aria-labelledby="appearance-heading">
			<h2 id="appearance-heading">Appearance</h2>
			<p className="muted">Applies to management and the panel immediately.</p>
			<div className="settings-row">
				<label className="setting" htmlFor="theme-selection">
					Theme
					<select
						id="theme-selection"
						value={appearance.theme}
						onChange={(event) => {
							if (isThemeSelection(event.target.value)) {
								setTheme(event.target.value);
							}
						}}
					>
						<option value="dark">Dark</option>
						<option value="light">Light</option>
						<option value="custom" disabled={!appearance.customTheme}>
							{appearance.customTheme
								? `Custom: ${appearance.customTheme.name}`
								: "Custom (import first)"}
						</option>
					</select>
				</label>
				<label className="setting" htmlFor="motion-selection">
					Motion
					<select
						id="motion-selection"
						value={appearance.motion}
						onChange={(event) => {
							if (isMotionPreference(event.target.value)) {
								setMotion(event.target.value);
							}
						}}
					>
						<option value="system">System</option>
						<option value="reduce">Reduce motion</option>
					</select>
				</label>
			</div>
			<p className="muted">
				{reducedMotion
					? "Nonessential motion is off."
					: "Short counter and control animations are on."}{" "}
				The OS reduced-motion setting always takes priority.
			</p>
			<label className="setting" htmlFor="custom-theme-file">
				Import custom theme
				<input
					id="custom-theme-file"
					type="file"
					accept=".json,application/json"
					disabled={loading}
					aria-describedby="theme-import-help theme-import-status"
					onChange={async (event) => {
						const file = event.currentTarget.files?.[0];
						event.currentTarget.value = "";
						if (!file) return;
						setLoading(true);
						setImportMessage("Reading theme…");
						const result = await loadCustomThemeFile(file);
						if (result.status === "valid") {
							importTheme(result.theme);
							setImportMessage(`Loaded ${result.theme.name}.`);
						} else {
							setImportMessage(result.reason);
						}
						setLoading(false);
					}}
				/>
			</label>
			<p id="theme-import-help" className="muted">
				JSON, up to 16 KiB. Override colors using six-digit hex values.
			</p>
			<p id="theme-import-status" role="status">
				{importMessage}
			</p>
			{notice && (
				<p className="notice" role="status">
					{notice}
				</p>
			)}
			<details>
				<summary>Custom theme example</summary>
				<pre>{example}</pre>
				<p className="muted">
					Color tokens: background, surface, foreground, muted, border, accent,
					accent-text, success, warning. Other colors inherit from the base.
				</p>
			</details>
		</section>
	);
}
