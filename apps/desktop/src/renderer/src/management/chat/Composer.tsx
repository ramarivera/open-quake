import {
	type RefObject,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
} from "react";
import { Icon } from "./icons";

export interface ComposerCopy {
	readonly label: string;
	readonly placeholder: string;
	readonly hint: string;
	/** Visible send label plus an optional suffix for the accessible name. */
	readonly send: readonly [string, string];
	readonly stop: readonly [string, string];
	readonly stopping: string;
}

/**
 * Sticky message composer shared by direct and runtime conversations.
 * Enter sends, Shift+Enter inserts a newline, and the primary action becomes
 * Stop while a response streams.
 */
export function Composer({
	value,
	onChange,
	onSubmit,
	onStop,
	canSend,
	disabled,
	running,
	stopping,
	notice,
	copy,
	inputRef,
}: {
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly onSubmit: () => void;
	readonly onStop?: (() => void) | undefined;
	readonly canSend: boolean;
	readonly disabled: boolean;
	readonly running: boolean;
	readonly stopping: boolean;
	/** Why sending is unavailable, shown in place of the keyboard hint. */
	readonly notice?: string | undefined;
	readonly copy: ComposerCopy;
	readonly inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
	const hintId = useId();
	// Sending disables the textarea, which drops focus; return it once the
	// reply ends if the message was sent from here.
	const refocus = useRef(false);
	useEffect(() => {
		if (!disabled && refocus.current) {
			refocus.current = false;
			inputRef.current?.focus();
		}
	}, [disabled, inputRef]);
	const send = () => {
		refocus.current = true;
		onSubmit();
	};
	// Grow with the draft up to a bounded height; the transcript keeps the rest.
	// biome-ignore lint/correctness/useExhaustiveDependencies: Height follows the draft text.
	useLayoutEffect(() => {
		const element = inputRef.current;
		if (!element) return;
		element.style.height = "auto";
		element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
	}, [value, inputRef]);
	return (
		<div className="cw-composer-dock">
			<form
				className="cw-composer"
				data-disabled={disabled || undefined}
				onSubmit={(event) => {
					event.preventDefault();
					if (canSend) send();
				}}
			>
				<textarea
					ref={inputRef}
					value={value}
					rows={2}
					maxLength={32768}
					aria-label={copy.label}
					aria-describedby={hintId}
					placeholder={copy.placeholder}
					disabled={disabled}
					onChange={(event) => onChange(event.target.value)}
					onKeyDown={(event) => {
						if (
							event.key === "Enter" &&
							!event.shiftKey &&
							!event.nativeEvent.isComposing
						) {
							event.preventDefault();
							if (canSend) send();
						}
					}}
				/>
				<div className="cw-composer-bar">
					<p
						id={hintId}
						className="cw-composer-hint"
						data-notice={notice ? true : undefined}
					>
						{notice ?? copy.hint}
					</p>
					{running && onStop ? (
						<button
							type="button"
							className="mc-button"
							disabled={stopping}
							onClick={onStop}
						>
							<Icon name="stop" />
							{stopping ? (
								copy.stopping
							) : (
								<>
									{copy.stop[0]}
									{copy.stop[1] && (
										<span className="visually-hidden">{copy.stop[1]}</span>
									)}
								</>
							)}
						</button>
					) : (
						<button
							type="submit"
							className="mc-button"
							data-primary
							disabled={!canSend}
						>
							{copy.send[0]}
							{copy.send[1] && (
								<span className="visually-hidden">{copy.send[1]}</span>
							)}
							<Icon name="send" />
						</button>
					)}
				</div>
			</form>
		</div>
	);
}
