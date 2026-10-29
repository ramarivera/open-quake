import { useEffect, useRef, useState } from "react";
import type { QuakeEventState } from "../useQuakeEvents";
import {
	applyPanelEvent,
	initialPanelFeedback,
	nextPanelDeadline,
	type PanelFeedbackView,
	viewPanelFeedback,
} from "./panelFeedback";

/** Folds the shared event log into panel feedback and expires it on time. */
export function usePanelFeedback(
	{
		events,
		eventsReceived,
	}: Pick<QuakeEventState, "events" | "eventsReceived">,
	inputDiagnostics = false,
): PanelFeedbackView {
	const [feedback, setFeedback] = useState(initialPanelFeedback);
	const [now, setNow] = useState(() => Date.now());
	const seen = useRef(0);
	const mode = useRef(inputDiagnostics);
	useEffect(() => {
		// The log keeps the latest 100 events; older unseen ones are gone.
		const fresh = Math.min(eventsReceived - seen.current, events.length);
		seen.current = eventsReceived;
		const changed = mode.current !== inputDiagnostics;
		mode.current = inputDiagnostics;
		const relevant = (fresh > 0 ? events.slice(-fresh) : []).filter(
			(event) => inputDiagnostics || event.kind === "status",
		);
		if (!relevant.length && !changed) return;
		const at = Date.now();
		setFeedback((current) =>
			relevant.reduce(
				(next, event) => applyPanelEvent(next, event, at),
				inputDiagnostics
					? current
					: { ...initialPanelFeedback, status: current.status },
			),
		);
		setNow(at);
	}, [events, eventsReceived, inputDiagnostics]);
	useEffect(() => {
		if (!inputDiagnostics) return;
		const deadline = nextPanelDeadline(feedback, now);
		if (deadline === null) return;
		const timer = setTimeout(() => setNow(Date.now()), deadline - now);
		return () => clearTimeout(timer);
	}, [feedback, now, inputDiagnostics]);
	return viewPanelFeedback(feedback, now);
}
