import { useRef, useState } from "react";
import type {
	KnobModelSnapshot,
	KnobRequest,
	MenuProfile,
} from "../../../../../shared/knob-contracts";
import {
	cardRect,
	type PickerTarget,
	pickerLayout,
	pickerTarget,
	sameTarget,
} from "./geometry";

export function ProfilePicker({
	snapshot,
	entries,
	request,
}: {
	snapshot: KnobModelSnapshot;
	entries: readonly MenuProfile[];
	request: (command: KnobRequest) => Promise<void>;
}): React.JSX.Element {
	const { context, selector } = snapshot;
	const sessionId = context.session.sessionId;
	const layout = pickerLayout(entries.length);
	const down = useRef<PickerTarget | undefined>(undefined);
	const cancelled = useRef(false);
	const [pressed, setPressed] = useState(-1);
	const focus = cardRect(entries.length, selector.index % 15);
	const current = context.profiles.find(
		(p) => p.id === context.session.profileId,
	);
	const target = (event: React.PointerEvent<HTMLDivElement>): PickerTarget => {
		const bounds = event.currentTarget.getBoundingClientRect();
		return pickerTarget(
			entries.length,
			selector.page,
			((event.clientX - bounds.left) * 1920) / bounds.width,
			((event.clientY - bounds.top) * 480) / bounds.height,
		);
	};
	return (
		<div
			className="knob-picker"
			role="dialog"
			aria-modal="true"
			aria-label="Switch profile"
			data-testid="profile-picker"
			onPointerDown={(event) => {
				down.current = target(event);
				cancelled.current = false;
				setPressed(down.current.kind === "card" ? down.current.index : -1);
				event.currentTarget.setPointerCapture(event.pointerId);
			}}
			onPointerMove={(event) => {
				if (down.current && !sameTarget(down.current, target(event))) {
					cancelled.current = true;
					setPressed(-1);
				}
			}}
			onPointerCancel={() => {
				down.current = undefined;
				setPressed(-1);
			}}
			onPointerUp={(event) => {
				const start = down.current;
				down.current = undefined;
				setPressed(-1);
				if (!start || cancelled.current || !sameTarget(start, target(event)))
					return;
				if (start.kind === "card") {
					const profile = entries[start.index];
					if (profile)
						void request({ _tag: "Select", sessionId, profileId: profile.id });
				} else if (start.kind === "page")
					void request({ _tag: "Page", sessionId, delta: start.delta });
				else void request({ _tag: "Dismiss", sessionId });
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape")
					void request({ _tag: "Dismiss", sessionId });
			}}
		>
			<header>
				<span>Switch profile</span>
				<span className="knob-current-label">
					Current · <em>{current?.name}</em>
				</span>
				<span className="knob-picker-hint">
					Rotate to choose · press to confirm
				</span>
			</header>
			{entries
				.slice(selector.page * 15, (selector.page + 1) * 15)
				.map((entry, offset) => {
					const rect = cardRect(entries.length, offset);
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
							) : null}
							<span className="knob-card-scrim" />
							<span className="knob-card-name">{entry.name}</span>
							{entry.id === context.session.profileId && !layout.paged ? (
								<span className="knob-current-badge">Current</span>
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
					{selector.page > 0 ? (
						<button
							type="button"
							className="knob-page-arrow knob-page-previous"
							aria-label="Previous page"
							onClick={(event) => {
								if (event.detail === 0)
									void request({ _tag: "Page", sessionId, delta: -1 });
							}}
						>
							‹
						</button>
					) : null}
					{selector.page < Math.ceil(entries.length / 15) - 1 ? (
						<button
							type="button"
							className="knob-page-arrow knob-page-next"
							aria-label="Next page"
							onClick={(event) => {
								if (event.detail === 0)
									void request({ _tag: "Page", sessionId, delta: 1 });
							}}
						>
							›
						</button>
					) : null}
					<footer>
						<span>
							{selector.page + 1} / {Math.ceil(entries.length / 15)}
						</span>
						<span>Tap to switch, or it switches automatically on timeout</span>
					</footer>
				</>
			) : null}
			<div className="knob-settle">
				<div style={{ width: `${selector.progress * 100}%` }} />
			</div>
		</div>
	);
}
