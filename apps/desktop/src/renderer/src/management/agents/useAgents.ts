import { useCallback, useEffect, useState } from "react";
import type {
	AgentInput,
	AgentReply,
	AgentsBridge,
	AgentView,
} from "../../../../shared/agents";
export function useAgents(bridge: AgentsBridge | undefined) {
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
			setBusy(true);
			setError("");
			try {
				const reply = await bridge.request(input);
				if (reply._tag === "success") apply(reply.view);
				else setError(`${reply.message} · ${reply.code}`);
				return reply;
			} catch {
				const reply: AgentReply = {
					_tag: "rejected",
					code: "AGENT.IPC.DISCONNECTED",
					message: "Agent management disconnected. Retry.",
				};
				setError(reply.message);
				return reply;
			} finally {
				setBusy(false);
			}
		},
		[bridge, apply],
	);
	useEffect(() => {
		if (!bridge) {
			setError("Agent management is unavailable");
			return;
		}
		let mounted = true;
		const off = bridge.onSnapshot((next) => {
			if (mounted) apply(next);
		});
		const offProgress = bridge.onProgress((progress) => {
			if (mounted)
				setView((current) => (current ? { ...current, progress } : current));
		});
		void bridge.request({ type: "read" }).then(
			(reply) => {
				if (!mounted) return;
				if (reply._tag === "success") apply(reply.view);
				else setError(`${reply.message} · ${reply.code}`);
			},
			() => {
				if (mounted) setError("Agent management disconnected. Retry.");
			},
		);
		return () => {
			mounted = false;
			off();
			offProgress();
		};
	}, [bridge, apply]);
	return { view, error, busy, request, setError };
}
export type AgentRequest = (input: AgentInput) => Promise<AgentReply>;
