import { useCallback, useEffect, useRef, useState } from "react";
import type {
	AgentInput,
	AgentReply,
	AgentsBridge,
	AgentView,
} from "../../../../shared/agents";
export function useAgents(bridge: AgentsBridge | undefined) {
	const generation = useRef(0);
	const events = useRef(0);
	const pending = useRef(0);
	const [view, setView] = useState<AgentView>();
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const apply = useCallback(
		(next: AgentView) =>
			setView((current) =>
				!current || next.revision >= current.revision ? next : current,
			),
		[],
	);
	const request = useCallback(
		async (input: AgentInput): Promise<AgentReply> => {
			if (!bridge) {
				const reply: AgentReply = {
					_tag: "rejected",
					code: "AGENT.IPC.UNAVAILABLE",
					message: "Agent management is unavailable",
				};
				setError(reply.message);
				return reply;
			}
			const owner = generation.current;
			const atEvent = events.current;
			pending.current++;
			setBusy(true);
			setError("");
			try {
				const reply = await bridge.request(input);
				if (owner !== generation.current) return reply;
				if (reply._tag === "success") {
					if (input.type !== "read" || atEvent === events.current)
						apply(reply.view);
				} else setError(`${reply.message} · ${reply.code}`);
				return reply;
			} catch {
				const reply: AgentReply = {
					_tag: "rejected",
					code: "AGENT.IPC.DISCONNECTED",
					message: "Agent management disconnected. Retry.",
				};
				if (owner === generation.current) setError(reply.message);
				return reply;
			} finally {
				pending.current--;
				if (owner === generation.current) setBusy(pending.current > 0);
			}
		},
		[bridge, apply],
	);
	useEffect(() => {
		if (!bridge) {
			setError("Agent management is unavailable");
			return;
		}
		const owner = ++generation.current;
		const atEvent = events.current;
		setView(undefined);
		setBusy(true);
		let mounted = true;
		const off = bridge.onSnapshot((next) => {
			if (mounted) {
				events.current++;
				apply(next);
			}
		});
		const offProgress = bridge.onProgress((progress) => {
			if (mounted)
				setView((current) => (current ? { ...current, progress } : current));
		});
		void bridge.request({ type: "read" }).then(
			(reply) => {
				if (!mounted) return;
				if (owner !== generation.current) return;
				setBusy(pending.current > 0);
				if (reply._tag === "success") {
					if (atEvent === events.current) apply(reply.view);
				} else setError(`${reply.message} · ${reply.code}`);
			},
			() => {
				if (mounted) {
					setBusy(false);
					setError("Agent management disconnected. Retry.");
				}
			},
		);
		return () => {
			mounted = false;
			if (generation.current === owner) generation.current++;
			off();
			offProgress();
		};
	}, [bridge, apply]);
	return { view, error, busy, request, setError };
}
export type AgentRequest = (input: AgentInput) => Promise<AgentReply>;
