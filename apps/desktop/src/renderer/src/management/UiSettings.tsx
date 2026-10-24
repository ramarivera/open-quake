import { useEffect, useRef, useState } from "react";
import type { AppearanceController } from "../theme/useAppearance";
import { Segmented } from "../ui/Form";
import { ControlsIcon } from "../ui/icons";
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
	return (
		<div className="mc-ui-settings-host" ref={host}>
			<button
				ref={button}
				className="mc-ui-settings-button"
				type="button"
				title="UI Settings"
				aria-label="UI Settings"
				aria-expanded={open}
				aria-controls="mc-ui-settings"
				onClick={() => setOpen(!open)}
			>
				<ControlsIcon />
			</button>
			{open ? (
				<section
					id="mc-ui-settings"
					className="mc-ui-settings"
					aria-label="UI Settings"
				>
					<h2>UI Settings</h2>
					<p id="mc-font-label">Font size</p>
					<Segmented
						name="mc-font"
						labelledBy="mc-font-label"
						value={controller.appearance.fontScale}
						options={[
							{ value: "small", label: "Small" },
							{ value: "medium", label: "Medium" },
							{ value: "large", label: "Large" },
						]}
						onChange={controller.setFontScale}
					/>
					<p id="mc-theme-label">Theme</p>
					<Segmented
						name="mc-theme"
						labelledBy="mc-theme-label"
						value={controller.appearance.theme}
						options={[
							{ value: "dark", label: "Dark" },
							{ value: "light", label: "Light" },
							{ value: "grey", label: "Grey" },
						]}
						onChange={controller.setTheme}
					/>
				</section>
			) : null}
		</div>
	);
}
