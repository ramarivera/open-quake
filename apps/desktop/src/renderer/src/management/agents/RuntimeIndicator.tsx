import type { RuntimeState } from "../../../../shared/agents";
import { agentsStrings as strings } from "./copy";
import type { AgentRequest } from "./useAgents";

const s = strings.openclawRuntimeIndicator;
const labels = {
	ready: s.statusReady,
	starting: s.statusStarting,
	stopping: s.statusStopping,
	error: s.statusError,
	stopped: s.statusStopped,
};
const tones = {
	ready: "success",
	starting: "warning",
	stopping: "warning",
	error: "danger",
	stopped: "neutral",
} as const;
/** Shell-wide label (sidebar status dot); keeps its full sentence. */
export function runtimeStatusLabel(runtime: RuntimeState): string {
	return runtime.available
		? labels[runtime.status]
		: "No agent runtime is installed";
}
/** The local OpenClaw runtime: status as dot plus text, labelled lifecycle actions. */
export function RuntimeIndicator({
	runtime,
	request,
}: {
	readonly runtime: RuntimeState;
	readonly request: AgentRequest;
}) {
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
				{runtime.available ? labels[runtime.status] : s.notInstalled}
			</span>
			{runtime.available && (
				<span className="aw-runtime-actions">
					{runtime.status === "ready" ? (
						<>
							<button
								type="button"
								className="mc-button"
								data-variant="quiet"
								aria-label={s.restart}
								onClick={() =>
									void request({ type: "runtime", action: "restart" })
								}
							>
								{s.restartShort}
							</button>
							<button
								type="button"
								className="mc-button"
								data-variant="quiet"
								aria-label={s.stop}
								onClick={() =>
									void request({ type: "runtime", action: "stop" })
								}
							>
								{s.stopShort}
							</button>
						</>
					) : (
						<button
							type="button"
							className="mc-button"
							aria-label={s.start}
							disabled={transitioning}
							onClick={() => void request({ type: "runtime", action: "start" })}
						>
							{s.startShort}
						</button>
					)}
				</span>
			)}
			{runtime.status === "error" && (
				<span role="alert" className="aw-runtime-error">
					{runtime.operation === "stop"
						? s.stopFailed
						: runtime.operation === "restart"
							? s.restartFailed
							: s.startFailed}{" "}
					<code className="cw-code aw-runtime-code">{runtime.code}</code>
				</span>
			)}
		</div>
	);
}
