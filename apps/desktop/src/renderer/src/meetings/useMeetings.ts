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
}
let view: MeetingView = { snapshot: undefined, error: "" };
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
		? { ...view, error: "Meeting response was invalid" }
		: decoded.right._tag === "failure"
			? { ...view, error: decoded.right.message }
			: { snapshot: decoded.right.snapshot, error: "" };
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
