import { useEffect, useRef, useState } from "react";
import type {
	KnobModelSnapshot,
	KnobRequest,
	MenuProfile,
} from "../../../../../shared/knob-contracts";
import { useLocaleText } from "../../../i18n";
import { cardRect, pageArrowRect, pickerLayout } from "./geometry";
import { mountPickerTouch } from "./picker-touch";

export function ProfilePicker({
	snapshot,
	entries,
	request,
	locale: providedLocale,
}: {
	snapshot: KnobModelSnapshot;
	locale?: string;
	entries: readonly MenuProfile[];
	request: (command: KnobRequest) => Promise<void>;
}): React.JSX.Element {
	const t = useLocaleText("picker", providedLocale);
	const { context, selector } = snapshot;
	const sessionId = context.session.sessionId;
	const layout = pickerLayout(entries.length);
	const picker = useRef<HTMLDivElement>(null);
	const currentEntries = useRef(entries);
	currentEntries.current = entries;
	const [pressed, setPressed] = useState(-1);
	const focus = cardRect(entries.length, selector.index % 15, selector.page);
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
				if (target.kind === "card") {
					const profile = currentEntries.current[target.index];
					if (profile)
						void request({ _tag: "Select", sessionId, profileId: profile.id });
				} else if (target.kind === "page")
					void request({ _tag: "Page", sessionId, delta: target.delta });
				else void request({ _tag: "Dismiss", sessionId });
			},
			setPressed,
		);
	}, [entries.length, selector.page, sessionId, request]);
	return (
		<div
			ref={picker}
			className="knob-picker"
			role="dialog"
			aria-modal="true"
			aria-label={t("title")}
			data-testid="profile-picker"
			onKeyDown={(event) => {
				if (event.key === "Escape")
					void request({ _tag: "Dismiss", sessionId });
			}}
		>
			<header>
				<span className="knob-picker-title">{t("title")}</span>
				<span className="knob-current-label">
					{t("currentPrefix")} · <em>{current?.name}</em>
				</span>
				<span className="knob-picker-hint">{t("knobHint")}</span>
			</header>
			{entries
				.slice(selector.page * 15, (selector.page + 1) * 15)
				.map((entry, offset) => {
					const rect = cardRect(entries.length, offset, selector.page);
					const index = selector.page * 15 + offset;
					return (
						<button
							key={entry.id}
							type="button"
							className="knob-profile-card"
							data-current={entry.id === context.session.profileId}
							data-focused={index === selector.index}
							data-pressed={index === pressed}
							aria-label={entry.name}
							style={{
								left: rect.x,
								top: rect.y,
								width: rect.width,
								height: rect.height,
								fontSize: layout.nameSize,
							}}
							onClick={(event) => {
								if (event.detail === 0)
									void request({
										_tag: "Select",
										sessionId,
										profileId: entry.id,
									});
							}}
						>
							{entry.thumbnail._tag === "ready" ? (
								<img src={entry.thumbnail.dataUrl} alt="" draggable="false" />
							) : (
								<span className="knob-card-placeholder" aria-hidden="true" />
							)}
							<span className="knob-card-scrim" />
							<span className="knob-card-name">{entry.name}</span>
							{entry.id === context.session.profileId && !layout.paged ? (
								<span className="knob-current-badge">{t("currentBadge")}</span>
							) : null}
						</button>
					);
				})}
			<div
				className="knob-picker-focus"
				style={{
					width: focus.width,
					height: focus.height,
					transform: `translate3d(${focus.x}px,${focus.y}px,0) scale(1.06)`,
				}}
			/>
			{layout.paged ? (
				<>
					{([-1, 1] as const).map((delta) => {
						const rect = pageArrowRect(delta);
						const hidden =
							delta < 0
								? selector.page === 0
								: selector.page >= Math.ceil(entries.length / 15) - 1;
						return (
							<button
								key={delta}
								type="button"
								className={`knob-page-arrow knob-page-${delta < 0 ? "previous" : "next"}`}
								aria-label={delta < 0 ? t("previousPage") : t("nextPage")}
								aria-hidden={hidden}
								disabled={hidden}
								style={{
									left: rect.x,
									top: rect.y,
									width: rect.width,
									height: rect.height,
									visibility: hidden ? "hidden" : "visible",
								}}
								onClick={(event) => {
									if (event.detail === 0 && !hidden)
										void request({ _tag: "Page", sessionId, delta });
								}}
							>
								{delta < 0 ? "‹" : "›"}
							</button>
						);
					})}
					<footer>
						<span>
							{selector.page + 1} / {Math.ceil(entries.length / 15)}
						</span>
						<span>{t("pageHint")}</span>
					</footer>
				</>
			) : null}
			<div className="knob-settle">
				<div style={{ width: `${selector.progress * 100}%` }} />
			</div>
		</div>
	);
}
