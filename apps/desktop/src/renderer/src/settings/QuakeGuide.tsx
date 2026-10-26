import { useEffect, useId, useRef, useState } from "react";
import { useAppTranslations } from "../i18n";
import { type ManagementPage, pageLocation } from "../management/navigation";
import { Callout } from "../ui/Form";
import {
	GUIDE_CONTENT,
	GUIDE_PLACES,
	GUIDE_TOPICS,
	type GuideBlock,
	type GuideTopic,
	restoreFocus,
	stepTopic,
} from "./guide-content";
import "./settings.css";

type T = ReturnType<typeof useAppTranslations>;
type OpenPage = (page: ManagementPage) => void;
type CloseReason = "dismiss" | "navigate";

/**
 * Settings › General entry for the bundled guide. It keeps the last topic so
 * reopening continues where the reader stopped, and returns focus to this
 * button after Esc, × or Done. The backdrop doesn't dismiss a reading dialog.
 */
export function QuakeGuideEntry({
	onOpenPage,
	label,
}: {
	label?: string;
	/** Optional root navigation; without it, places are listed as text only. */
	onOpenPage?: OpenPage | undefined;
}): React.JSX.Element {
	const t = useAppTranslations("settings");
	const opener = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [topic, setTopic] = useState<GuideTopic>("start");
	return (
		<>
			<button
				ref={opener}
				type="button"
				className="mc-button"
				aria-haspopup="dialog"
				onClick={() => setOpen(true)}
			>
				{label ?? t("guide.open")}
			</button>
			{open ? (
				<QuakeGuideDialog
					topic={topic}
					onTopic={setTopic}
					onOpenPage={onOpenPage}
					onClose={(reason, page) => {
						restoreFocus(opener.current, reason);
						setOpen(false);
						if (page) onOpenPage?.(page);
					}}
				/>
			) : null}
		</>
	);
}

/** A native modal dialog: the browser traps focus and Esc raises `cancel`. */
export function QuakeGuideDialog({
	topic,
	onTopic,
	onClose,
	onOpenPage,
}: {
	topic: GuideTopic;
	onTopic: (topic: GuideTopic) => void;
	/** Called after the dialog has closed, so focus can move outside it. */
	onClose: (reason: CloseReason, page?: ManagementPage) => void;
	onOpenPage?: OpenPage | undefined;
}): React.JSX.Element {
	const t = useAppTranslations("settings");
	const id = useId();
	const dialog = useRef<HTMLDialogElement>(null);
	const heading = useRef<HTMLHeadingElement>(null);
	const body = useRef<HTMLDivElement>(null);
	const focusHeading = useRef(false);
	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
		heading.current?.focus({ preventScroll: true });
		return () => element?.close();
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once per topic change.
	useEffect(() => {
		body.current?.scrollTo({ top: 0 });
		if (focusHeading.current) heading.current?.focus({ preventScroll: true });
		focusHeading.current = false;
	}, [topic]);
	const finish = (reason: CloseReason, page?: ManagementPage): void => {
		dialog.current?.close();
		onClose(reason, page);
	};
	const go = (next: GuideTopic, moveFocus: boolean): void => {
		focusHeading.current = moveFocus;
		onTopic(next);
	};
	const index = GUIDE_TOPICS.indexOf(topic);
	const last = index === GUIDE_TOPICS.length - 1;
	const next = stepTopic(topic, 1);
	const label = (item: GuideTopic) => t(`guide.topics.${item}.label`);
	return (
		<dialog
			ref={dialog}
			className="guide-dialog"
			aria-labelledby={`${id}-title`}
			onCancel={(event) => {
				event.preventDefault();
				finish("dismiss");
			}}
		>
			<div className="guide-frame">
				<header className="guide-header">
					<div className="guide-heading">
						<h2 id={`${id}-title`}>{t("guide.title")}</h2>
						<p>{t("guide.subtitle")}</p>
					</div>
					<button
						type="button"
						className="mc-button guide-close"
						data-variant="quiet"
						aria-label={t("guide.close")}
						onClick={() => finish("dismiss")}
					>
						<span aria-hidden="true">×</span>
					</button>
				</header>
				<div className="guide-layout">
					<nav className="guide-rail" aria-label={t("guide.topicsLabel")}>
						<ol>
							{GUIDE_TOPICS.map((item, position) => (
								<li key={item}>
									<button
										type="button"
										aria-current={item === topic ? "true" : undefined}
										onClick={() => go(item, false)}
									>
										<span className="guide-rail-index" aria-hidden="true">
											{position + 1}
										</span>
										<span className="guide-rail-label">{label(item)}</span>
									</button>
								</li>
							))}
						</ol>
					</nav>
					<div className="guide-picker">
						<select
							className="guide-picker-select"
							aria-label={t("guide.topicsLabel")}
							value={topic}
							onChange={(event) => {
								const chosen = GUIDE_TOPICS.find(
									(item) => item === event.target.value,
								);
								if (chosen) go(chosen, false);
							}}
						>
							{GUIDE_TOPICS.map((item, position) => (
								<option key={item} value={item}>
									{`${position + 1}. ${label(item)}`}
								</option>
							))}
						</select>
					</div>
					<div className="guide-body" ref={body}>
						<article className="guide-article" aria-labelledby={`${id}-topic`}>
							<p className="guide-progress">
								{t("guide.topicOf", {
									current: index + 1,
									total: GUIDE_TOPICS.length,
								})}
							</p>
							<h3 id={`${id}-topic`} ref={heading} tabIndex={-1}>
								{t(`guide.topics.${topic}.title`)}
							</h3>
							<GuideTopicBody
								t={t}
								topic={topic}
								onOpenPage={
									onOpenPage ? (page) => finish("navigate", page) : undefined
								}
							/>
						</article>
					</div>
				</div>
				<footer className="guide-footer">
					{index > 0 ? (
						<button
							type="button"
							className="mc-button"
							onClick={() => go(stepTopic(topic, -1), true)}
						>
							{t("guide.previous")}
						</button>
					) : null}
					{last ? (
						<button
							type="button"
							className="mc-button"
							data-variant="primary"
							onClick={() => finish("dismiss")}
						>
							{t("guide.done")}
						</button>
					) : (
						<button
							type="button"
							className="mc-button"
							data-variant="primary"
							onClick={() => go(next, true)}
						>
							{t("guide.next", { topic: label(next) })}
						</button>
					)}
				</footer>
			</div>
		</dialog>
	);
}

/** One topic's blocks with the bundled copy; exported for static render tests. */
export function GuideTopicBody({
	t,
	topic,
	onOpenPage,
}: {
	t: T;
	topic: GuideTopic;
	onOpenPage?: OpenPage | undefined;
}): React.JSX.Element {
	const at = (key: string) => t(`guide.topics.${topic}.${key}`);
	const block = (item: GuideBlock, position: number) => {
		switch (item.kind) {
			case "text":
				return (
					<p key={position} className="guide-text">
						{at(item.key)}
					</p>
				);
			case "list":
				return (
					<section key={position} className="guide-section">
						<h4>{at(item.heading)}</h4>
						<ul className="guide-list">
							{item.items.map((key) => (
								<li key={key}>{at(key)}</li>
							))}
						</ul>
					</section>
				);
			case "terms":
				return (
					<dl key={position} className="guide-terms">
						{item.items.map((entry) => (
							<div key={entry.term} className="guide-term">
								<dt>{at(entry.term)}</dt>
								<dd>{at(entry.detail)}</dd>
							</div>
						))}
					</dl>
				);
			case "note":
				return (
					<div key={position} className="guide-note">
						<Callout tone={item.tone}>{at(item.key)}</Callout>
					</div>
				);
			case "places":
				return (
					<ul key={position} className="guide-places">
						{GUIDE_PLACES.map((page) => {
							const place = pageLocation(page);
							const name = place.section
								? `${place.section} › ${place.label}`
								: place.label;
							return (
								<li key={page}>
									<div className="guide-place-text">
										<span className="guide-place-name">{name}</span>
										<span className="guide-place-detail">
											{t(`guide.places.${page}`)}
										</span>
									</div>
									{onOpenPage ? (
										<button
											type="button"
											className="mc-button"
											data-variant="quiet"
											aria-label={t("guide.openPage", { page: name })}
											onClick={() => onOpenPage(page)}
										>
											{t("guide.go")}
										</button>
									) : null}
								</li>
							);
						})}
					</ul>
				);
		}
	};
	return <>{GUIDE_CONTENT[topic].map(block)}</>;
}
