import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	KnobModelSnapshot,
	KnobReply,
	type KnobRequest,
} from "../../../../../shared/knob-contracts";

export function useKnob() {
	const [snapshot, setSnapshot] = useState<KnobModelSnapshot>();
	const [notice, setNotice] = useState("");
	const revision = useRef(-1);
	useEffect(() => {
		const bridge = window.quakeKnob;
		if (!bridge) return;
		revision.current = -1;
		let alive = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let pending: KnobModelSnapshot;
		const accept = (value: unknown): void => {
			if (
				!alive ||
				!Schema.is(KnobModelSnapshot)(value) ||
				value.revision <= revision.current
			)
				return;
			revision.current = value.revision;
			// Domain deltas are never dropped; React renders the newest authoritative frame.
			pending = value;
			if (!timer)
				timer = setTimeout(() => {
					timer = undefined;
					if (alive) setSnapshot(pending);
				}, 16);
		};
		const off = bridge.onSnapshot(accept);
		void bridge
			.request({ _tag: "Read" })
			.then((reply) => {
				if (Schema.is(KnobReply)(reply) && reply._tag === "success")
					accept(reply.snapshot);
			})
			.catch(() => {
				if (alive) setNotice("Knob controls are unavailable");
			});
		return () => {
			alive = false;
			off();
			if (timer) clearTimeout(timer);
		};
	}, []);
	const request = useCallback(async (command: KnobRequest): Promise<void> => {
		try {
			const reply = await window.quakeKnob?.request(command);
			if (Schema.is(KnobReply)(reply) && reply._tag === "failure")
				setNotice(
					reply.code === "QUAKE.KNOB.SESSION_STALE"
						? ""
						: "This control is unavailable",
				);
			else setNotice("");
		} catch {
			setNotice("Knob controls are unavailable");
		}
	}, []);
	return { snapshot, notice, request };
}
