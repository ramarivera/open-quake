import type { RuntimeState } from "../../../../shared/agents";
import { type AgentsCopy, useAgentsCopy } from "./copy";
import type { AgentRequest } from "./useAgents";

const tones = {
	ready: "success",
	starting: "warning",
	stopping: "warning",
	error: "danger",
	stopped: "neutral",
} as const;
const statusLabels = (s: AgentsCopy["openclawRuntimeIndicator"]) => ({
	ready: s.statusReady,
	starting: s.statusStarting,
	stopping: s.statusStopping,
	error: s.statusError,
	stopped: s.statusStopped,
});
/** Shell-wide label (sidebar status dot); keeps its full sentence. */
export function runtimeStatusLabel(
	runtime: RuntimeState,
	s: AgentsCopy["openclawRuntimeIndicator"],
): string {
	return runtime.available
		? statusLabels(s)[runtime.status]
		: s.shellNotConfigured;
}
/** The local OpenClaw runtime: status as dot plus text, labelled lifecycle actions. */
export function RuntimeIndicator({
	runtime,
	request,
}: {
	readonly runtime: RuntimeState;
	readonly request: AgentRequest;
}) {
	const s = useAgentsCopy().openclawRuntimeIndicator;
	const labels = statusLabels(s);
	const transitioning =
		runtime.status === "starting" || runtime.status === "stopping";
	return (
		<div className="aw-runtime" data-runtime={runtime.status}>
			<span className="aw-runtime-label">{s.title}</span>
			<span className="aw-runtime-status" role="status">
				<span
					className="cw-dot"
					data-tone={runtime.available ? tones[runtime.status] : "neutral"}
					aria-hidden="true"
				/>
				{runtime.available ? labels[runtime.status] : s.notConfigured}
			</span>
			{!runtime.available && (
				<span className="aw-runtime-hint">{s.setupHint}</span>
			)}
			<span className="aw-runtime-actions">
				{(["start", "stop", "restart"] as const).map((action) => {
					const disabled =
						!runtime.available ||
						transitioning ||
						(action === "start"
							? runtime.status === "ready"
							: runtime.status !== "ready");
					return (
						<button
							key={action}
							type="button"
							className="mc-button"
							data-variant="quiet"
							aria-label={s[action]}
							disabled={disabled}
							onClick={() => {
								if (!disabled) void request({ type: "runtime", action });
							}}
						>
							{action === "start"
								? s.startShort
								: action === "stop"
									? s.stopShort
									: s.restartShort}
						</button>
					);
				})}
			</span>
			{runtime.status === "error" && (
				<span role="alert" className="aw-runtime-error">
					{runtime.operation === "stop"
						? s.stopFailed
						: runtime.operation === "restart"
							? s.restartFailed
							: s.startFailed}{" "}
				</span>
			)}
		</div>
	);
}
