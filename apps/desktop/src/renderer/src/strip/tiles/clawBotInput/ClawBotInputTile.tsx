import { Option } from "effect";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "../../css-properties";
import { type StripStringKey, stripText } from "../../overlays/voice/strings";
import { useSubTouchTap } from "../../overlays/voice/sub-touch";
import type { StripTileProps } from "../../tileRegistry";
import { checkSend, inputScale } from "./input-state";
import "./clawBotInput.css";

const WARNING_MS = 1800;

/**
 * ClawBotInput (`quakeBotInput`, 2×2; QBI, strip-voice-ui "ClawBotInput").
 * "Open WebChat" is omitted: it puts the gateway token in a URL (AI-186).
 */
export function ClawBotInputTile({
	tile,
	context,
}: StripTileProps): React.JSX.Element {
	const voice = context.voice;
	const { width, height } = tile.box;
	const s = inputScale(width, height);
	const state = voice.view.input;
	const interactive = voice.surface === "panel";
	const [text, setText] = useState("");
	const [warning, setWarning] = useState<
		{ readonly key: StripStringKey } | undefined
	>();
	const [pressed, setPressed] = useState<string>();
	const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const box = useRef<HTMLTextAreaElement>(null);
	const recovery = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const focusOwner = useRef<object | undefined>(undefined);
	const ownsFocus =
		interactive && !voice.wheelOpen && !voice.view.overlay.visible;
	useLayoutEffect(() => {
		const owner = ownsFocus
			? {
					keyCode: state.keyCode,
					agentId: state.agentId,
					epoch: voice.view.focusEpoch,
				}
			: undefined;
		focusOwner.current = owner;
		return () => {
			focusOwner.current = undefined;
			clearTimeout(recovery.current);
		};
	}, [ownsFocus, state.keyCode, state.agentId, voice.view.focusEpoch]);
	const recoverFocus = (): void => {
		clearTimeout(recovery.current);
		const owner = focusOwner.current;
		if (!owner) return;
		recovery.current = setTimeout(() => {
			if (focusOwner.current === owner) box.current?.focus();
		}, 100);
	};
	const send = useRef<HTMLButtonElement>(null);
	const attach = useRef<HTMLButtonElement>(null);
	// Voice partials and finals overwrite the box (QBI:371-462).
	// biome-ignore lint/correctness/useExhaustiveDependencies: the revision marks new voice text.
	useEffect(() => {
		if (state.revision > 0) setText(state.voice.text);
	}, [state.revision]);
	useEffect(() => {
		if (!warning) return;
		const timer = setTimeout(() => setWarning(undefined), WARNING_MS);
		return () => clearTimeout(timer);
	}, [warning]);
	useEffect(() => () => clearTimeout(flashTimer.current), []);
	const flash = (action: string): void => {
		clearTimeout(flashTimer.current);
		setPressed(action);
		flashTimer.current = setTimeout(() => setPressed(undefined), 150);
	};
	const onSend = (): void => {
		const check = checkSend(state, text);
		if (check._tag === "warn") {
			setWarning({ key: check.key });
		}
		if (check._tag !== "send") return;
		void voice
			.request({
				_tag: "SendText",
				keyCode: check.keyCode,
				agentId: check.agentId,
				message: check.message,
			})
			.then((reply) => {
				if (reply._tag === "ok")
					setText((current) => (current === text ? "" : current));
			})
			.catch(() => undefined);
	};
	const onAttach = (): void => {
		void voice.request({ _tag: "PickFiles" }).then((reply) => {
			if (reply._tag === "files" && reply.paths.length > 0)
				setText((value) =>
					[value.trimEnd(), ...reply.paths].filter(Boolean).join("\n"),
				);
		});
	};
	// A tap on the strip focuses the strip window first (QBI:598-653).
	const onFocusRequest = (): void => {
		const owner = focusOwner.current;
		if (!owner) return;
		void voice
			.request({ _tag: "FocusPanel" })
			.then(() => {
				if (focusOwner.current === owner) box.current?.focus();
			})
			.catch(() => undefined);
	};
	useSubTouchTap(send, () => {
		if (interactive) {
			flash("send");
			onSend();
		}
	});
	useSubTouchTap(attach, () => {
		if (interactive) {
			flash("attach");
			onAttach();
		}
	});
	useSubTouchTap(box, onFocusRequest);
	const agent = Option.getOrElse(state.agentName, () => "");
	return (
		<div
			className="clawbot-input"
			style={{ width, height, borderRadius: tile.tileRadius || 24 }}
		>
			<div
				className="clawbot-input-header"
				style={{ height: 52 * s, padding: `0 ${18 * s}px`, gap: 10 * s }}
			>
				<span
					className="clawbot-input-icon"
					style={{
						width: 28 * s,
						height: 28 * s,
						borderRadius: 8 * s,
						fontSize: 20 * s,
					}}
				>
					✏️
				</span>
				<span className="clawbot-input-title" style={{ fontSize: 22 * s }}>
					{stripText(voice.locale, "quakeBotInputIconView.title")}
					{agent === "" ? "" : ` · ${agent}`}
				</span>
			</div>
			<div
				className="clawbot-input-body"
				style={{
					padding: `${18 * s}px ${12 * s}px ${15 * s}px`,
					marginTop: -8 * s,
					gap: 10 * s,
				}}
			>
				<textarea
					ref={box}
					className="clawbot-input-box"
					rows={6}
					value={text}
					readOnly={!interactive}
					placeholder={
						interactive
							? stripText(voice.locale, "quakeBotInputIconView.placeholder")
							: undefined
					}
					data-quake-sub-touch="quakeBotInputTextarea"
					onBlur={recoverFocus}
					onFocus={() => clearTimeout(recovery.current)}
					onChange={(event) => setText(event.target.value)}
					style={{
						minHeight: 120 * s,
						borderRadius: 16 * s,
						padding: `${16 * s}px ${20 * s}px`,
						fontSize: 22 * s,
					}}
				/>
				<div className="clawbot-input-actions" style={{ gap: 12 * s }}>
					{(
						[
							[
								send,
								"📤",
								"quakeBotInputIconView.quickActions.send.label",
								onSend,
							],
							[
								attach,
								"📎",
								"quakeBotInputIconView.quickActions.fileAttach.label",
								onAttach,
							],
						] as const
					).map(([ref, icon, label, action]) => (
						<button
							key={label}
							ref={ref}
							type="button"
							className="clawbot-input-button"
							data-pressed={
								pressed === (ref === send ? "send" : "attach") || undefined
							}
							data-quake-sub-touch={label}
							disabled={!interactive}
							onClick={action}
							style={{
								minHeight: 48 * s,
								borderRadius: 20 * s,
								fontSize: 20 * s,
								gap: 6 * s,
							}}
						>
							<span aria-hidden="true">{icon}</span>
							{stripText(voice.locale, label)}
						</button>
					))}
				</div>
			</div>
			{warning ? (
				<div
					className="clawbot-input-warning"
					role="alert"
					style={{
						top: 8 * s,
						maxWidth: 300 * s,
						fontSize: 20 * s,
						padding: `${8 * s}px ${14 * s}px`,
						borderRadius: 12 * s,
					}}
				>
					{stripText(voice.locale, warning.key)}
				</div>
			) : null}
		</div>
	);
}
