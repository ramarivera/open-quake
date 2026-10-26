import { Either } from "effect";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
	decodeMeetingReply,
	type MeetingCommand,
	type MeetingSnapshot,
} from "../../../shared/meeting-bridge";

interface MeetingView {
	readonly snapshot: MeetingSnapshot | undefined;
	readonly error: string;
	readonly failureVersion: number;
}
let view: MeetingView = { snapshot: undefined, error: "", failureVersion: 0 };
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
function accept(value: unknown): void {
	const decoded = decodeMeetingReply(value);
	if (
		Either.isRight(decoded) &&
		decoded.right._tag === "ready" &&
		view.snapshot &&
		decoded.right.snapshot.revision < view.snapshot.revision
	)
		return;
	view = Either.isLeft(decoded)
		? {
				...view,
				error: "Meeting response was invalid",
				failureVersion: view.failureVersion + 1,
			}
		: decoded.right._tag === "failure"
			? {
					...view,
					error: decoded.right.message,
					failureVersion: view.failureVersion + 1,
				}
			: { ...view, snapshot: decoded.right.snapshot, error: "" };
	for (const listener of listeners) listener();
}
export async function meetingRequest(
	command: MeetingCommand,
): Promise<boolean> {
	const bridge = window.quakeMeetings;
	if (!bridge) {
		accept({
			_tag: "failure",
			code: "QUAKE.MEETING.UNAVAILABLE",
			message: "Meeting services are unavailable",
		});
		return false;
	}
	try {
		const value: unknown = await bridge.request(command);
		accept(value);
		const reply = decodeMeetingReply(value);
		return Either.isRight(reply) && reply.right._tag === "ready";
	} catch {
		accept({
			_tag: "failure",
			code: "QUAKE.MEETING.UNAVAILABLE",
			message: "Meeting services are unavailable",
		});
		return false;
	}
}
function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	if (listeners.size === 1) {
		stop = window.quakeMeetings?.onSnapshot(accept);
		void meetingRequest({ _tag: "read" });
	}
	return () => {
		listeners.delete(listener);
		if (!listeners.size) {
			stop?.();
			stop = undefined;
			view = { snapshot: undefined, error: "", failureVersion: 0 };
		}
	};
}
export const useMeetings = (): MeetingView =>
	useSyncExternalStore(
		subscribe,
		() => view,
		() => view,
	);
export function useMeetingNow(): number {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 100);
		return () => clearInterval(timer);
	}, []);
	return now;
}

/** Mount reads are owned by the store; subsequent host activations refresh again. */
export function useMeetingActivation(activation: number): void {
	const mounted = useState(() => ({ activation }))[0];
	useEffect(() => {
		if (mounted.activation !== activation) {
			mounted.activation = activation;
			void meetingRequest({ _tag: "read" });
		}
	}, [activation, mounted]);
	useEffect(() => {
		const focus = () => {
			void meetingRequest({ _tag: "read" });
		};
		const shown = () => {
			if (document.visibilityState === "visible") focus();
		};
		window.addEventListener("focus", focus);
		document.addEventListener("visibilitychange", shown);
		// CaptureHost can keep the store subscribed while the history page is absent.
		void meetingRequest({ _tag: "read" });
		return () => {
			window.removeEventListener("focus", focus);
			document.removeEventListener("visibilitychange", shown);
		};
	}, []);
}
