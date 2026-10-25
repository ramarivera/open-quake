import { Option } from "effect";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { TurnSnapshot } from "../../../../../../../packages/edge/src/chat/chat-contracts";
import type { DirectChatBridge } from "../../../../shared/chat";
import { RichText } from "../../strip/tiles/clawBot/RichText";
import { parseRichText } from "../../strip/tiles/clawBot/rich-text";
import { ActionDialog } from "../agent-http/ActionDialog";
import { createChatController } from "./controller";
import "./chat.css";

const strings = {
	en: {
		title: "Direct chat",
		hint: "Uses your saved default model from AI settings. Chat history stays on this device.",
		newChat: "New chat",
		empty: "Send a message to start a conversation.",
		send: "Send",
		cancel: "Stop response",
		message: "Message",
		history: "Conversation history",
		loading: "Loading conversations",
		rename: "Rename",
		clear: "Delete conversation",
		clearBody:
			"Delete this conversation and its saved history from this device?",
		you: "You",
		answer: "Generated answer",
		unavailable:
			"Configure a default model and API key in AI settings before chatting.",
		retry: "Retry",
		name: "Conversation title",
	},
	de: {
		title: "Direkter Chat",
		hint: "Verwendet dein gespeichertes Standardmodell aus den KI-Einstellungen. Der Verlauf bleibt auf diesem Gerät.",
		newChat: "Neuer Chat",
		empty: "Sende eine Nachricht, um ein Gespräch zu beginnen.",
		send: "Senden",
		cancel: "Antwort stoppen",
		message: "Nachricht",
		history: "Gesprächsverlauf",
		loading: "Gespräche werden geladen",
		rename: "Umbenennen",
		clear: "Gespräch löschen",
		clearBody:
			"Dieses Gespräch und seinen gespeicherten Verlauf von diesem Gerät löschen?",
		you: "Du",
		answer: "Generierte Antwort",
		unavailable:
			"Lege zuerst ein Standardmodell und einen API-Schlüssel in den KI-Einstellungen fest.",
		retry: "Erneut versuchen",
		name: "Gesprächstitel",
	},
};
export function DirectChatPanel({
	bridge = window.quakeChat,
	configured,
	locale = "en",
}: {
	readonly bridge?: DirectChatBridge | undefined;
	readonly configured: boolean;
	readonly locale?: string;
}) {
	const [controller] = useState(() => createChatController(bridge));
	const state = useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
		controller.getSnapshot,
	);
	const t = locale === "de" ? strings.de : strings.en;
	const [text, setText] = useState("");
	const [title, setTitle] = useState("");
	const [deleting, setDeleting] = useState(false);
	const scroll = useRef<HTMLElement>(null),
		follow = useRef(true);
	useEffect(() => {
		void controller.refresh();
		return () => controller.dispose();
	}, [controller]);
	useEffect(() => {
		setTitle(state.current?.title ?? "");
	}, [state.current?.title]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: Streaming should follow only while the reader remains at the bottom.
	useLayoutEffect(() => {
		if (follow.current && scroll.current)
			scroll.current.scrollTop = scroll.current.scrollHeight;
	}, [state.turn?.lastSeq, state.current?.revision]);
	const open = (url: string) => {
		void window.quakeVoice?.request({ _tag: "OpenLink", url });
	};
	const answer = (snapshot: TurnSnapshot) => (
		<>
			<RichText value={parseRichText(snapshot.text)} scale={1} onOpen={open} />
			{Option.isSome(snapshot.terminal) && (
				<small className="direct-chat-status">
					{snapshot.terminal.value.outcome}
					{snapshot.terminal.value.errorCode
						? ` · ${snapshot.terminal.value.errorCode}`
						: ""}
					{snapshot.terminal.value.usage
						? ` · ${snapshot.terminal.value.usage.inputTokens} / ${snapshot.terminal.value.usage.outputTokens} tokens · ${snapshot.terminal.value.usage.provenance}`
						: ""}
				</small>
			)}
		</>
	);
	return (
		<section className="mc-panel direct-chat" aria-label={t.title}>
			<header className="mc-toolbar">
				<div>
					<h2>{t.title}</h2>
					<p>{t.hint}</p>
				</div>
				<button
					type="button"
					className="mc-button"
					disabled={state.pending}
					onClick={() => void controller.select()}
				>
					{t.newChat}
				</button>
			</header>
			{!configured && <p role="status">{t.unavailable}</p>}
			{state.error && (
				<p role="alert">
					{state.error}{" "}
					<button
						type="button"
						className="mc-button"
						onClick={() => void controller.refresh()}
					>
						{t.retry}
					</button>
				</p>
			)}
			<div className="direct-chat-layout">
				<nav aria-label={t.history} className="direct-chat-history">
					{state.loading ? (
						<p role="status">{t.loading}</p>
					) : (
						state.histories.map((item) => (
							<button
								type="button"
								className="mc-button"
								key={item.sessionId}
								aria-current={
									item.sessionId === state.sessionId ? "true" : undefined
								}
								disabled={state.pending}
								onClick={() => void controller.select(item.sessionId)}
							>
								{item.title}
							</button>
						))
					)}
				</nav>
				<div className="direct-chat-main">
					<section
						ref={scroll}
						className="direct-chat-transcript"
						aria-label={t.history}
						onScroll={() => {
							const el = scroll.current;
							if (el)
								follow.current =
									el.scrollHeight - el.scrollTop - el.clientHeight < 32;
						}}
					>
						{!state.current && !state.turn && <p>{t.empty}</p>}
						{state.current?.turns
							.filter((turn) => turn.selection.turnId !== state.turn?.turnId)
							.map((turn) => (
								<article
									className="direct-chat-exchange"
									key={turn.selection.turnId}
								>
									<p>
										<strong>{t.you}</strong>
									</p>
									<p className="direct-chat-user">{turn.input}</p>
									<p>
										<strong>{t.answer}</strong>
									</p>
									{answer(turn.snapshot)}
								</article>
							))}
						{state.turn && (
							<article className="direct-chat-exchange">
								<p>
									<strong>{t.you}</strong>
								</p>
								<p className="direct-chat-user">{state.input}</p>
								<p>
									<strong>{t.answer}</strong>
								</p>
								{answer(state.turn)}
							</article>
						)}
					</section>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							const value = text;
							void controller.submit(value);
							setText("");
						}}
					>
						<label className="mc-field">
							{t.message}
							<textarea
								value={text}
								maxLength={32768}
								disabled={!configured || state.pending || !bridge}
								onChange={(event) => setText(event.target.value)}
								rows={3}
							/>
						</label>
						<div className="direct-chat-actions">
							<button
								type="submit"
								className="mc-button"
								disabled={
									!configured || state.pending || !text.trim() || !bridge
								}
							>
								{t.send}
							</button>
							{state.pending && (
								<button
									type="button"
									className="mc-button"
									disabled={state.cancelling}
									onClick={() => void controller.cancel()}
								>
									{t.cancel}
								</button>
							)}
						</div>
					</form>
					{state.current && (
						<div className="direct-chat-actions">
							<label className="mc-field">
								{t.name}
								<input
									value={title}
									maxLength={200}
									disabled={state.pending}
									onChange={(event) => setTitle(event.target.value)}
								/>
							</label>
							<button
								type="button"
								className="mc-button"
								disabled={state.pending || !title.trim()}
								onClick={() => void controller.rename(title)}
							>
								{t.rename}
							</button>
							<button
								type="button"
								className="mc-button"
								disabled={state.pending}
								onClick={() => setDeleting(true)}
							>
								{t.clear}
							</button>
						</div>
					)}
				</div>
			</div>
			{deleting && (
				<ActionDialog
					title={t.clear}
					body={t.clearBody}
					confirm={t.clear}
					busy={state.pending}
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
