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
export function usePanelFeedback({
	events,
	eventsReceived,
}: Pick<QuakeEventState, "events" | "eventsReceived">): PanelFeedbackView {
	const [feedback, setFeedback] = useState(initialPanelFeedback);
	const [now, setNow] = useState(() => Date.now());
	const seen = useRef(0);
	useEffect(() => {
		// The log keeps the latest 100 events; older unseen ones are gone.
		const fresh = Math.min(eventsReceived - seen.current, events.length);
		seen.current = eventsReceived;
		if (fresh <= 0) return;
		const at = Date.now();
		setFeedback((current) =>
			events
				.slice(-fresh)
				.reduce((next, event) => applyPanelEvent(next, event, at), current),
		);
		setNow(at);
	}, [events, eventsReceived]);
	useEffect(() => {
		const deadline = nextPanelDeadline(feedback, now);
		if (deadline === null) return;
		const timer = setTimeout(() => setNow(Date.now()), deadline - now);
		return () => clearTimeout(timer);
	}, [feedback, now]);
	return viewPanelFeedback(feedback, now);
}
