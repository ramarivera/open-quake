import { useId, useState } from "react";
import { Callout, Group, PageHeader, Row, Segmented } from "../ui/Form";
import type { MotionPreference, ThemeSelection } from "./appearance";
import { customThemeTokens, loadCustomThemeFile } from "./customTheme";
import {
	builtinThemeOrder,
	type ThemeTokens,
	themeLabels,
	themes,
	themeTokenNames,
} from "./tokens";
import type { AppearanceController } from "./useAppearance";

const example = JSON.stringify(
	{ version: 1, name: "My theme", base: "dark", colors: { accent: "#b7a3ff" } },
	null,
	2,
);

/** A miniature of this window painted with the palette it would apply. */
function ThemeSwatch({
	tokens,
}: {
	tokens: ThemeTokens | null;
}): React.JSX.Element {
	if (!tokens) return <span className="theme-swatch" data-empty="true" />;
	return (
		<span
			className="theme-swatch"
			style={{ background: tokens.background, borderColor: tokens.border }}
		>
			<span className="theme-swatch-sidebar">
				<span style={{ background: tokens.accent }} />
				<span style={{ background: tokens.muted }} />
				<span style={{ background: tokens.muted }} />
			</span>
			<span className="theme-swatch-content">
				<span
					className="theme-swatch-group"
					style={{ background: tokens.surface }}
				>
					<span style={{ background: tokens.foreground }} />
					<span style={{ background: tokens.muted }} />
				</span>
				<span
					className="theme-swatch-group"
					style={{ background: tokens.surface }}
				>
					<span style={{ background: tokens.foreground }} />
					<span style={{ background: tokens.success }} />
				</span>
			</span>
		</span>
	);
}

export function ThemeSettings({
	controller,
}: {
	controller: AppearanceController;
}): React.JSX.Element {
	const [importMessage, setImportMessage] = useState("");
	const [loading, setLoading] = useState(false);
	const ids = useId();
	const {
		appearance,
		notice,
		reducedMotion,
		setTheme,
		setMotion,
		importTheme,
	} = controller;
	const custom = appearance.customTheme;
	const choices: ReadonlyArray<{
		value: ThemeSelection;
		label: string;
		tokens: ThemeTokens | null;
	}> = [
		...builtinThemeOrder.map((id) => ({
			value: id,
			label: themeLabels[id],
			tokens: themes[id],
		})),
		{
			value: "custom",
			label: custom ? custom.name : "Custom",
			tokens: custom ? customThemeTokens(custom) : null,
		},
	];
	const motionOptions: ReadonlyArray<{
		value: MotionPreference;
		label: string;
	}> = [
		{ value: "system", label: "System" },
		{ value: "reduce", label: "Reduce" },
	];

	return (
		<div className="page">
			<PageHeader
				title="Appearance"
				description="Theme, text size and motion for open-quake. Changes apply right away."
			/>

			<Group
				title="Theme"
				footer={
					custom ? null : (
						<p id={`${ids}-custom-hint`}>
							Import a theme file below to use Custom.
						</p>
					)
				}
			>
				<div
					className="theme-picker"
					role="radiogroup"
					aria-label="Theme"
					aria-describedby={custom ? undefined : `${ids}-custom-hint`}
				>
					{choices.map((choice) => {
						const unavailable = choice.value === "custom" && !custom;
						return (
							<label
								key={choice.value}
								className="theme-choice"
								data-disabled={unavailable || undefined}
							>
								<input
									type="radio"
									name={`${ids}-theme`}
									value={choice.value}
									checked={appearance.theme === choice.value}
									disabled={unavailable}
									onChange={() => setTheme(choice.value)}
								/>
								<ThemeSwatch tokens={choice.tokens} />
								<span className="theme-choice-label">{choice.label}</span>
							</label>
						);
					})}
				</div>
			</Group>

			<Group title="Motion">
				<Row
					label="Animations"
					labelId={`${ids}-motion`}
					hint={
						<>
							{reducedMotion
								? "Nonessential motion is off."
								: "Short counter and control animations are on."}{" "}
							Your system's reduce-motion setting always takes priority.
						</>
					}
				>
					<Segmented
						name={`${ids}-motion`}
						labelledBy={`${ids}-motion`}
						value={appearance.motion}
						options={motionOptions}
						onChange={setMotion}
					/>
				</Row>
			</Group>

			<Group
				title="Custom theme"
				footer={
					<>
						<p id={`${ids}-import-status`} role="status">
							{importMessage}
						</p>
						{notice ? (
							<Callout tone="warning">
								<span role="status">{notice}</span>
							</Callout>
						) : null}
					</>
				}
			>
				<Row
					label="Theme file"
					hint={
						<span id={`${ids}-import-help`}>
							JSON, up to 16 KiB. Override colors with six-digit hex values.
						</span>
					}
				>
					<label className="button file-button" data-disabled={loading}>
						<input
							id="custom-theme-file"
							type="file"
							accept=".json,application/json"
							disabled={loading}
							aria-describedby={`${ids}-import-help ${ids}-import-status`}
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
						Import Theme…
					</label>
				</Row>
				<details className="disclosure">
					<summary>Theme file format</summary>
					<pre>{example}</pre>
					<p>
						Color tokens: {themeTokenNames.join(", ")}. Anything you leave out
						comes from the base theme.
					</p>
				</details>
			</Group>
		</div>
	);
}
