import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	KnobModelSnapshot,
	KnobReply,
	type KnobRequest,
} from "../../../../../shared/knob-contracts";
import { knobThumbnailDecoder } from "./thumbnail-decoding";

export function useKnob() {
	const [snapshot, setSnapshot] = useState<KnobModelSnapshot>();
	const [notice, setNotice] = useState("");
	const revision = useRef(-1);
	const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const active = useRef(true);
	const showNotice = useCallback((text: string) => {
		if (!active.current) return;
		if (noticeTimer.current) clearTimeout(noticeTimer.current);
		setNotice(text);
		noticeTimer.current = text
			? setTimeout(() => setNotice(""), 3000)
			: undefined;
	}, []);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
			if (noticeTimer.current) clearTimeout(noticeTimer.current);
		};
	}, []);
	useEffect(() => {
		const bridge = window.quakeKnob;
		if (!bridge) return;
		revision.current = -1;
		let alive = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let pending: KnobModelSnapshot;
		const decoder = knobThumbnailDecoder((decoded) => {
			pending = decoded;
			if (!timer)
				timer = setTimeout(() => {
					timer = undefined;
					if (alive) setSnapshot(pending);
				}, 16);
		});
		const accept = (value: unknown): void => {
			if (
				!alive ||
				!Schema.is(KnobModelSnapshot)(value) ||
				value.revision <= revision.current
			)
				return;
			revision.current = value.revision;
			decoder.accept(value);
		};
		const off = bridge.onSnapshot(accept);
		void bridge
			.request({ _tag: "Read" })
			.then((reply) => {
				if (Schema.is(KnobReply)(reply) && reply._tag === "success")
					accept(reply.snapshot);
			})
			.catch(() => {
				if (alive) showNotice("Knob controls are unavailable");
			});
		return () => {
			alive = false;
			decoder.dispose();
			off();
			if (timer) clearTimeout(timer);
		};
	}, [showNotice]);
	const request = useCallback(
		async (command: KnobRequest): Promise<void> => {
			try {
				const reply = await window.quakeKnob?.request(command);
				if (Schema.is(KnobReply)(reply) && reply._tag === "failure")
					showNotice(
						reply.code === "QUAKE.KNOB.SESSION_STALE"
							? ""
							: "This control is unavailable",
					);
				else showNotice("");
			} catch {
				showNotice("Knob controls are unavailable");
			}
		},
		[showNotice],
	);
	return { snapshot, notice, request };
}
