import type { MenuProfile } from "../../../../../shared/knob-contracts";
import { useLocaleText } from "../../../i18n";
import { SceneCards } from "./SceneCards";

/** Passive knob feedback; the model owns selection, deadlines and activation. */
export function FunctionWheel({
	entries,
	index,
	direction,
	motion = "full",
	activeId,
}: {
	entries: readonly MenuProfile[];
	index: number;
	direction: -1 | 1;
	motion?: "full" | "reduce";
	activeId?: string;
}): React.JSX.Element | null {
	const t = useLocaleText("picker");
	if (!entries.length) return null;
	const current = entries.find((entry) => entry.id === activeId);
	return (
		<>
			<span role="status" aria-live="polite" className="visually-hidden">
				{entries[index]?.name}
			</span>
			<div
				className="scene-rail scene-knob"
				data-motion={motion}
				data-direction={direction}
				data-testid="function-wheel"
				role="img"
				aria-label={t("title")}
			>
				<div className="scene-instructions">
					<span className="scene-kicker">{t("scenes")}</span>
					<h1>{t("title")}</h1>
					{current ? (
						<p>
							{t("currentPrefix")} · {current.name}
						</p>
					) : null}
					<p>{t("knobHint")}</p>
					<p className="scene-timeout">{t("pageHint")}</p>
				</div>
				<SceneCards entries={entries} index={index} activeId={activeId} />
			</div>
		</>
	);
}
