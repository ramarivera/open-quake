import { useEffect, useRef, useState } from "react";
import { builtinThemeOrder, themeLabels } from "../theme/tokens";
import type { AppearanceController } from "../theme/useAppearance";
import { Segmented } from "../ui/Form";
import { TextSizeIcon } from "../ui/icons";
import { LanguageControl, useLanguageLabel } from "./LanguageControl";

/** Sidebar footer popover for the two settings people change most often. */
export function UiSettings({
	controller,
}: {
	controller: AppearanceController;
}): React.JSX.Element {
	const [open, setOpen] = useState(false);
	const host = useRef<HTMLDivElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (!open) return;
		const close = (): void => {
			setOpen(false);
			button.current?.focus();
		};
		const outside = (event: PointerEvent): void => {
			if (event.target instanceof Node && !host.current?.contains(event.target))
				close();
		};
		const onEscape = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				event.preventDefault();
				close();
			}
		};
		document.addEventListener("pointerdown", outside);
		document.addEventListener("keydown", onEscape);
		return () => {
			document.removeEventListener("pointerdown", outside);
			document.removeEventListener("keydown", onEscape);
		};
	}, [open]);
	const theme = controller.appearance.theme;
	const languageLabel = useLanguageLabel();
	return (
		<div className="mc-ui-settings-host" ref={host}>
			<button
				ref={button}
				className="mc-ui-settings-button"
				type="button"
				title="UI Settings"
				aria-expanded={open}
				aria-controls="mc-ui-settings"
				onClick={() => setOpen(!open)}
			>
				<TextSizeIcon />
				<span>Display</span>
				<span className="mc-ui-settings-summary">
					{theme === "custom"
						? (controller.appearance.customTheme?.name ?? "Custom")
						: themeLabels[theme]}
				</span>
			</button>
			{open ? (
				<section
					id="mc-ui-settings"
					className="mc-ui-settings"
					aria-labelledby="mc-ui-settings-title"
				>
					<h2 id="mc-ui-settings-title">Display</h2>
					<p id="mc-font-label">Text size</p>
					<Segmented
						name="mc-font"
						labelledBy="mc-font-label"
						value={controller.appearance.fontScale}
						options={[
							{ value: "small", label: "Default" },
							{ value: "medium", label: "Larger" },
							{ value: "large", label: "Largest" },
						]}
						onChange={controller.setFontScale}
					/>
					<p id="mc-theme-label">Theme</p>
					<Segmented
						name="mc-theme"
						labelledBy="mc-theme-label"
						value={theme}
						options={builtinThemeOrder.map((id) => ({
							value: id,
							label: themeLabels[id],
						}))}
						onChange={controller.setTheme}
					/>
					<p id="mc-language-label">{languageLabel}</p>
					<LanguageControl name="mc-language" labelledBy="mc-language-label" />
				</section>
			) : null}
		</div>
	);
}
