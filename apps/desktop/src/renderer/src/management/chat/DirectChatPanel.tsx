import { Option } from "effect";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { TurnSnapshot } from "../../../../../../../packages/edge/src/chat/chat-contracts";
import type { DirectChatBridge } from "../../../../shared/chat";
import { parseRichText } from "../../strip/tiles/clawBot/rich-text";
import { ActionDialog } from "../agent-http/ActionDialog";
import { Composer } from "./Composer";
import { createChatController } from "./controller";
import { pinEndOnResize, revealEnd } from "./follow";
import { fill, relativeTime } from "./format";
import { Icon } from "./icons";
import type { DirectChatModel } from "./model-scope";
import { Prose } from "./Prose";
import strings from "./strings.json";
import "./workspace.css";

export type ChatStrings = (typeof strings)["en"];
export const chatStrings = (locale: string): ChatStrings =>
	locale === "de" ? strings.de : strings.en;
export const errorText = (t: ChatStrings, code: string): string =>
	(t.errors as Readonly<Record<string, string>>)[code] ?? t.errorTitle;

export interface QuakeRoute {
	/** Name of the selected runtime connection that receives QUAKE requests. */
	readonly runtime: string | undefined;
	readonly busy: boolean;
	readonly useDirect: () => void;
}

export function DirectChatPanel({
	bridge = window.quakeChat,
	model,
	locale = "en",
	sources,
	quake,
	onOpenSettings,
	hidden = false,
	configurationLoading = false,
	configurationError,
	onRetryConfiguration,
}: {
	readonly hidden?: boolean;
	/** Model settings are still being read; readiness is not known yet. */
	readonly configurationLoading?: boolean;
	/** Model settings couldn't be read; distinct from "not configured". */
	readonly configurationError?: string | undefined;
	readonly onRetryConfiguration?: (() => void) | undefined;
	readonly bridge?: DirectChatBridge | undefined;
	readonly model: DirectChatModel;
	readonly locale?: string;
	/** Source switcher rendered at the top of the rail. */
	readonly sources?: ReactNode;
	readonly quake?: QuakeRoute | undefined;
	readonly onOpenSettings?: (() => void) | undefined;
}) {
	const [controller] = useState(() => createChatController(bridge));
	const state = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
		controller.getSnapshot,
	);
	const t = chatStrings(locale);
	const settings = configurationLoading
		? "loading"
		: configurationError
			? "failed"
			: model.ready
				? "ready"
				: "missing";
	const configured = settings === "ready";
	const modelName = model.row
		? `${model.row.provider} / ${model.row.model}`
		: t.directNotSet;
	const busy = state.pending || state.clearing;
	const [text, setText] = useState("");
	const [title, setTitle] = useState("");
	const [deleting, setDeleting] = useState(false);
	const [listOpen, setListOpen] = useState(false);
	const scroll = useRef<HTMLElement>(null),
		follow = useRef(true),
		reveal = useRef(false),
		shown = useRef<string | undefined>(undefined),
		input = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		void controller.refresh();
		return () => controller.dispose();
	}, [controller]);
	useEffect(() => {
		setTitle(state.current?.title ?? "");
	}, [state.current?.title]);
	useEffect(() => {
		const el = scroll.current;
		return el ? pinEndOnResize(el, () => follow.current) : undefined;
	}, []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Streaming should follow only while the reader remains at the bottom.
	useLayoutEffect(() => {
		// Opening another conversation always lands on its newest message.
		const opened = shown.current !== state.sessionId;
		shown.current = state.sessionId;
		if (scroll.current)
			revealEnd(scroll.current, follow.current, reveal.current || opened);
		reveal.current = false;
	}, [state.turn?.lastSeq, state.current?.revision, state.sessionId]);
	const open = (url: string) => {
		void window.quakeVoice?.request({ _tag: "OpenLink", url });
	};
	const compose = (value: string) => {
		setText(value);
		input.current?.focus();
	};
	const submit = () => {
		const value = text;
		follow.current = true;
		reveal.current = true;
		void controller.submit(value).then((accepted) => {
			if (accepted) setText((draft) => (draft === value ? "" : draft));
		});
	};
	const renaming = Boolean(
		state.current && title.trim() && title !== state.current.title,
	);
	const turns =
		state.current?.turns.filter(
			(turn) => turn.selection.turnId !== state.turn?.turnId,
		) ?? [];
	const lastTurn = turns.at(-1);
	const now = Date.now();
	const answer = (
		snapshot: TurnSnapshot,
		input: string,
		last: boolean,
		live: boolean,
	) => {
		const terminal = Option.getOrUndefined(snapshot.terminal);
		const usage = terminal?.usage;
		return (
			<div className="cw-answer">
				<p className="cw-answer-label">{t.assistant}</p>
				{snapshot.text ? (
					<Prose
						value={parseRichText(snapshot.text)}
						onOpen={open}
						linkHint={t.openLink}
					/>
				) : (
					live && (
						<p className="cw-waiting" role="status">
							<span className="cw-pulse" aria-hidden="true" />
							{state.cancelling ? t.stopping : t.waiting}
						</p>
					)
				)}
				{live && snapshot.text && (
					<p className="cw-turn-meta" role="status">
						<span className="cw-pulse" aria-hidden="true" />
						{state.cancelling ? t.stopping : t.streaming}
					</p>
				)}
				{terminal && (
					<div
						className="cw-turn-meta direct-chat-status"
						data-outcome={terminal.outcome}
					>
						<span>{t.outcome[terminal.outcome]}</span>
						{terminal.errorCode && (
							<code className="cw-code">{terminal.errorCode}</code>
						)}
						{usage && (
							<span>
								{fill(t.tokens, {
									input: usage.inputTokens,
									output: usage.outputTokens,
								})}{" "}
								· {t[usage.provenance]}
							</span>
						)}
					</div>
				)}
				{terminal?.errorCode && last && (
					<div className="cw-turn-error">
						<p>{errorText(t, terminal.errorCode)}</p>
						<button
							type="button"
							className="mc-button"
							data-variant="quiet"
							disabled={state.pending}
							onClick={() => compose(input)}
						>
							{t.reuse}
						</button>
					</div>
				)}
				{last &&
					terminal?.outcome === "completed" &&
					snapshot.suggestions.length > 0 && (
						<ul className="cw-suggestions" aria-label={t.suggestions}>
							{snapshot.suggestions.map((item) => (
								<li key={item.suggestionId}>
									<button
										type="button"
										className="cw-chip"
										disabled={state.pending}
										onClick={() => compose(item.text)}
									>
										{item.text}
									</button>
								</li>
							))}
						</ul>
					)}
			</div>
		);
	};
	const exchange = (
		key: string,
		input: string,
		snapshot: TurnSnapshot,
		last: boolean,
		live: boolean,
	) => (
		<article className="direct-chat-exchange cw-turn" key={key}>
			<div className="cw-user">
				<p className="visually-hidden">{t.you}</p>
				<p className="direct-chat-user cw-bubble">{input}</p>
			</div>
			{answer(snapshot, input, last, live)}
		</article>
	);
	const empty = !state.current?.turns.length && !state.turn;
	return (
		<section
			className="direct-chat cw-view"
			aria-label={t.direct}
			hidden={hidden}
		>
			<aside className="cw-rail" data-open={listOpen || undefined}>
				{sources}
				<div className="cw-sessions">
					<div className="cw-sessions-head">
						<h3 id="direct-chat-history-label">{t.conversations}</h3>
						<button
							type="button"
							className="mc-button cw-list-toggle"
							data-variant="quiet"
							aria-expanded={listOpen}
							aria-controls="direct-chat-history"
							onClick={() => setListOpen((value) => !value)}
						>
							<span className="cw-toggle-source">{t.direct}</span>
							<span className="cw-toggle-label">
								{listOpen ? t.hideConversations : t.showConversations}
							</span>
							<Icon name="chevron" />
							{state.histories.length > 0 && (
								<span className="cw-count">{state.histories.length}</span>
							)}
						</button>
						<button
							type="button"
							className="mc-button"
							title={t.newChatHint}
							disabled={busy || (!state.current && !state.turn)}
							onClick={() => {
								setListOpen(false);
								setText("");
								void controller.select();
								input.current?.focus();
							}}
						>
							<Icon name="plus" />
							{t.newChat}
						</button>
					</div>
					<nav
						id="direct-chat-history"
						aria-labelledby="direct-chat-history-label"
						className="direct-chat-history cw-session-list"
						data-open={listOpen || undefined}
					>
						{state.loading ? (
							<p className="cw-muted" role="status">
								{t.loading}
							</p>
						) : state.histories.length === 0 ? (
							<p className="cw-muted">{t.noConversations}</p>
						) : (
							[...state.histories]
								.sort((a, b) => b.updatedAt - a.updatedAt)
								.map((item) => (
									<button
										type="button"
										className="cw-session"
										key={item.sessionId}
										aria-current={
											item.sessionId === state.sessionId ? "true" : undefined
										}
										disabled={busy}
										onClick={() => {
											setListOpen(false);
											void controller.select(item.sessionId);
										}}
									>
										<span className="cw-session-title">
											{item.title || t.untitled}
										</span>
										<span className="cw-session-meta">
											{relativeTime(item.updatedAt, now, locale, t.justNow)}
										</span>
									</button>
								))
						)}
					</nav>
				</div>
			</aside>
			<div className="cw-main">
				<header className="cw-header">
					<div className="cw-header-title">
						{state.current ? (
							<form
								className="cw-title-form"
								onSubmit={(event) => {
									event.preventDefault();
									if (renaming && !state.pending) void controller.rename(title);
								}}
							>
								<input
									className="cw-title-input"
									aria-label={t.title}
									value={title}
									maxLength={200}
									disabled={state.pending}
									onChange={(event) => setTitle(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Escape")
											setTitle(state.current?.title ?? "");
									}}
								/>
								{renaming && (
									<>
										<button
											type="submit"
											className="mc-button"
											data-primary
											disabled={state.pending}
										>
											{t.rename}
										</button>
										<button
											type="button"
											className="mc-button"
											data-variant="quiet"
											onClick={() => setTitle(state.current?.title ?? "")}
										>
											{t.cancelRename}
										</button>
									</>
								)}
							</form>
						) : (
							<h2 className="cw-title">{t.untitled}</h2>
						)}
						<p className="cw-identity">
							<span
								className="cw-dot"
								data-tone={
									settings === "ready"
										? "success"
										: settings === "failed"
											? "danger"
											: settings === "loading"
												? "neutral"
												: "warning"
								}
								aria-hidden="true"
							/>
							<span>
								{settings === "loading"
									? t.loadingConfiguration
									: settings === "failed"
										? t.configurationFailed
										: model.row
											? fill(t.answeredBy, { model: modelName })
											: t.directNotSet}
							</span>
							<span
								className="cw-quake-note"
								data-actionable={quake?.runtime ? true : undefined}
							>
								<span aria-hidden="true">·</span>
								<span>
									{quake?.runtime
										? fill(t.quakeElsewhere, { name: quake.runtime })
										: t.quakeHere}
								</span>
								{quake?.runtime && (
									<button
										type="button"
										className="cw-inline-action"
										disabled={quake.busy}
										onClick={quake.useDirect}
									>
										{t.useDirectForQuake}
									</button>
								)}
							</span>
						</p>
					</div>
					<div className="cw-header-actions">
						{onOpenSettings && (
							<button
								type="button"
								className="mc-button"
								data-variant="quiet"
								onClick={onOpenSettings}
							>
								<Icon name="settings" />
								{t.modelSettings}
							</button>
						)}
						{state.current && (
							<button
								type="button"
								className="mc-button"
								data-variant="quiet"
								disabled={busy}
								onClick={() => setDeleting(true)}
							>
								<Icon name="trash" />
								{t.delete}
								{t.deleteSuffix && (
									<span className="visually-hidden">{t.deleteSuffix}</span>
								)}
							</button>
						)}
					</div>
				</header>
				{state.error && (
					<div className="cw-banner" role="alert">
						<p>
							<strong>{errorText(t, state.error)}</strong>{" "}
							<code className="cw-code">{state.error}</code>
						</p>
						<div className="cw-banner-actions">
							<button
								type="button"
								className="mc-button"
								onClick={() => void controller.refresh()}
							>
								{t.retry}
							</button>
							<button
								type="button"
								className="mc-button"
								data-variant="quiet"
								onClick={controller.dismissError}
							>
								{t.dismiss}
							</button>
						</div>
					</div>
				)}
				<section
					ref={scroll}
					className="direct-chat-transcript cw-transcript"
					aria-label={t.transcript}
					onScroll={() => {
						const el = scroll.current;
						if (el)
							follow.current =
								el.scrollHeight - el.scrollTop - el.clientHeight < 32;
					}}
				>
					{empty && !state.loading && (
						<div className="cw-empty">
							{settings === "loading" ? (
								<p className="cw-waiting" role="status">
									<span className="cw-pulse" aria-hidden="true" />
									{t.loadingConfiguration}
								</p>
							) : settings === "failed" ? (
								<div role="alert">
									<h3>{t.configurationFailed}</h3>
									<p>
										{configurationError}{" "}
										<span className="cw-muted">
											{t.configurationFailedBody}
										</span>
									</p>
									{onRetryConfiguration && (
										<button
											type="button"
											className="mc-button"
											data-primary
											onClick={onRetryConfiguration}
										>
											{t.retry}
										</button>
									)}
								</div>
							) : configured ? (
								<>
									<h3>{t.emptyTitle}</h3>
									<p>{fill(t.emptyBody, { model: modelName })}</p>
								</>
							) : (
								<>
									<h3>{t.setupTitle}</h3>
									<p>{t.setupBody}</p>
									{onOpenSettings && (
										<button
											type="button"
											className="mc-button"
											data-primary
											onClick={onOpenSettings}
										>
											<Icon name="settings" />
											{t.setupAction}
										</button>
									)}
									<p className="cw-muted">{t.setupOrRuntime}</p>
								</>
							)}
						</div>
					)}
					{turns.map((turn) =>
						exchange(
							turn.selection.turnId,
							turn.input,
							turn.snapshot,
							turn === lastTurn && !state.turn,
							false,
						),
					)}
					{state.turn &&
						exchange(
							state.turn.turnId,
							state.input,
							state.turn,
							true,
							state.pending,
						)}
				</section>
				<Composer
					value={text}
					onChange={setText}
					onSubmit={submit}
					onStop={() => void controller.cancel()}
					canSend={configured && !busy && Boolean(text.trim()) && !!bridge}
					disabled={!configured || busy || !bridge}
					running={state.pending}
					stopping={state.cancelling}
					notice={
						settings === "ready"
							? undefined
							: settings === "loading"
								? t.loadingConfiguration
								: settings === "failed"
									? t.configurationFailed
									: t.setupTitle
					}
					inputRef={input}
					copy={{
						label: t.message,
						placeholder: fill(t.placeholder, {
							name: model.row?.model ?? t.direct,
						}),
						hint: t.composerHint,
						send: [t.send, ""],
						stop: [t.cancel, t.cancelSuffix],
						stopping: t.stopping,
					}}
				/>
			</div>
			{deleting && (
				<ActionDialog
					title={t.clear}
					body={t.clearBody}
					confirm={t.clear}
					busy={busy}
					onClose={() => setDeleting(false)}
					onConfirm={async () => {
						await controller.clear();
						setDeleting(false);
					}}
				/>
			)}
		</section>
	);
}
