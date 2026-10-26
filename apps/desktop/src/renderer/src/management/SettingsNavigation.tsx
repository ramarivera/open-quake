import { useRef } from "react";
import { useAppLocale } from "../i18n";
import type { ManagementPage } from "./navigation";

/** Settings use the existing shell and canonical device owner, never duplicate stores. */
export function SettingsNavigation({
	page,
	onOpen,
}: {
	readonly page: "settings" | "controls";
	readonly onOpen: (page: ManagementPage) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const { locale } = useAppLocale();
	const items = [
		{ page: "settings", label: locale === "de" ? "Allgemein" : "General" },
		{ page: "controls", label: locale === "de" ? "Gerät" : "Device" },
	] as const;
	return (
		<div
			ref={ref}
			className="mc-tabs shell-settings-tabs"
			role="tablist"
			aria-label="Settings sections"
		>
			{items.map((item, index) => (
				<button
					key={item.page}
					type="button"
					role="tab"
					id={`shell-tab-${item.page}`}
					aria-controls="shell-settings-panel"
					aria-selected={page === item.page}
					tabIndex={page === item.page ? 0 : -1}
					onClick={() => onOpen(item.page)}
					onKeyDown={(event) => {
						const next =
							event.key === "Home"
								? 0
								: event.key === "End"
									? items.length - 1
									: event.key === "ArrowRight"
										? (index + 1) % items.length
										: event.key === "ArrowLeft"
											? (index + items.length - 1) % items.length
											: undefined;
						if (next === undefined) return;
						event.preventDefault();
						const target = items[next];
						if (target) onOpen(target.page);
						const button =
							ref.current?.querySelectorAll<HTMLButtonElement>("button")[next];
						button?.focus();
						button?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
					}}
				>
					{item.label}
				</button>
			))}
		</div>
	);
}
