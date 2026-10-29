import type { MenuProfile } from "../../../../../shared/knob-contracts";
import { useLocaleText } from "../../../i18n";
import { sceneSlots } from "./scene-rail";

export function SceneCards({
	entries,
	index,
	activeId,
	locale,
	pressed = -1,
	select,
}: {
	entries: readonly MenuProfile[];
	index: number;
	activeId?: string | undefined;
	locale?: string | undefined;
	pressed?: number;
	select?: ((profile: MenuProfile) => void) | undefined;
}): React.JSX.Element {
	const t = useLocaleText("picker", locale);
	return (
		<>
			{sceneSlots(entries.length, index).map((slot) => {
				const entry = entries[slot.index];
				if (!entry) return null;
				const selected = slot.position === "selected";
				const current = entry.id === activeId;
				const content = (
					<>
						<div className="scene-card-meta">
							<span>{t(slot.position)}</span>
							<span>
								{current
									? t("currentBadge")
									: String(slot.index + 1).padStart(2, "0")}
							</span>
						</div>
						<div className="scene-card-name" title={entry.name}>
							{entry.name}
						</div>
						<div className="scene-card-preview">
							{entry.thumbnail._tag === "ready" ? (
								<img src={entry.thumbnail.dataUrl} alt="" draggable={false} />
							) : (
								<span className="knob-card-placeholder" aria-hidden="true" />
							)}
						</div>
						<div className="scene-card-action">
							{selected
								? t(current ? "keep" : "switchTo")
								: t(
										slot.position === "previous" ? "turnLeft" : "turnRight",
									)}{" "}
							· <span>{entry.name}</span>
						</div>
					</>
				);
				const props = {
					className: "knob-profile-card scene-card",
					"data-position": slot.position,
					"data-current": current,
					"data-focused": selected,
					"data-pressed": slot.index === pressed,
					style: {
						left: slot.rect.x,
						top: slot.rect.y,
						width: slot.rect.width,
						height: slot.rect.height,
					},
				};
				return select ? (
					<button
						{...props}
						key={entry.id}
						type="button"
						aria-label={entry.name}
						aria-current={current ? "true" : undefined}
						onClick={(event) => {
							if (event.detail === 0) select(entry);
						}}
					>
						{content}
					</button>
				) : (
					<div {...props} key={entry.id}>
						{content}
					</div>
				);
			})}
		</>
	);
}
