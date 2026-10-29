import { useEffect, useRef, useState } from "react";
import {
	KNOB_PROFILE_PAGE_SIZE,
	type KnobModelSnapshot,
	type KnobRequest,
	type MenuProfile,
} from "../../../../../shared/knob-contracts";
import { useLocaleText } from "../../../i18n";
import { mountPickerTouch } from "./picker-touch";
import { SceneCards } from "./SceneCards";
import { scenePageRect, sceneTarget } from "./scene-rail";

export function ProfilePicker({
	snapshot,
	entries,
	request,
	locale,
}: {
	snapshot: KnobModelSnapshot;
	locale?: string;
	entries: readonly MenuProfile[];
	request: (command: KnobRequest) => Promise<void>;
}): React.JSX.Element {
	const t = useLocaleText("picker", locale);
	const { context, selector } = snapshot;
	const sessionId = context.session.sessionId;
	const picker = useRef<HTMLDivElement>(null);
	const latestEntries = useRef(entries);
	latestEntries.current = entries;
	const [pressed, setPressed] = useState(-1);
	const current = context.profiles.find(
		(p) => p.id === context.session.profileId,
	);
	useEffect(() => {
		const root = document.getElementById("root");
		if (!root || !picker.current) return;
		return mountPickerTouch(
			root,
			picker.current,
			entries.length,
			selector.page,
			(target) => {
				const profile =
					target.kind === "card"
						? latestEntries.current[target.index]
						: undefined;
				void request(
					target.kind === "page"
						? { _tag: "Page", sessionId, delta: target.delta }
						: profile
							? { _tag: "Select", sessionId, profileId: profile.id }
							: { _tag: "Dismiss", sessionId },
				);
			},
			setPressed,
			(x, y) => sceneTarget(entries.length, selector.index, x, y),
		);
	}, [entries.length, selector.index, selector.page, sessionId, request]);
	return (
		<div
			ref={picker}
			className="knob-picker scene-rail"
			role="dialog"
			aria-modal="true"
			aria-label={t("title")}
			data-testid="profile-picker"
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					void request({ _tag: "Dismiss", sessionId });
				}
			}}
		>
			<header className="scene-instructions">
				<span className="scene-kicker">{t("scenes")}</span>
				<h1>{t("title")}</h1>
				<p className="knob-current-label">
					{t("currentPrefix")} · <em>{current?.name}</em>
				</p>
				<p className="knob-picker-hint">{t("knobHint")}</p>
				<p className="scene-timeout">{t("pageHint")}</p>
			</header>
			{entries.length > KNOB_PROFILE_PAGE_SIZE ? (
				<div className="scene-pages">
					{([-1, 1] as const).map((delta) => {
						const rect = scenePageRect(delta);
						return (
							<button
								type="button"
								key={delta}
								style={{
									left: rect.x,
									top: rect.y,
									width: rect.width,
									height: rect.height,
								}}
								aria-label={`${t("jumpTo")} ${entries[Math.max(0, Math.min(Math.ceil(entries.length / KNOB_PROFILE_PAGE_SIZE) - 1, selector.page + delta)) * KNOB_PROFILE_PAGE_SIZE]?.name ?? ""}`}
								disabled={
									delta < 0
										? selector.page === 0
										: selector.page >=
											Math.ceil(entries.length / KNOB_PROFILE_PAGE_SIZE) - 1
								}
								onClick={(event) => {
									if (event.detail === 0)
										void request({ _tag: "Page", sessionId, delta });
								}}
							>
								{delta < 0 ? "‹" : "›"}
							</button>
						);
					})}
				</div>
			) : null}
			<button
				className="scene-close"
				type="button"
				onClick={(event) => {
					if (event.detail === 0) void request({ _tag: "Dismiss", sessionId });
				}}
			>
				× {t("closeWithoutSwitching")}
			</button>
			<SceneCards
				entries={entries}
				index={selector.index}
				activeId={context.session.profileId}
				locale={locale}
				pressed={pressed}
				select={(entry) =>
					void request({ _tag: "Select", sessionId, profileId: entry.id })
				}
			/>
			<div className="scene-count">
				{entries.length ? selector.index + 1 : 0} / {entries.length}
			</div>
			<div
				className="scene-settle"
				role="progressbar"
				aria-label={t("autoSwitch")}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(selector.progress * 100)}
			>
				<span style={{ width: `${selector.progress * 100}%` }} />
			</div>
		</div>
	);
}
