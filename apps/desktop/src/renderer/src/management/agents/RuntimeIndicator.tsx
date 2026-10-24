import type { RuntimeState } from "../../../../shared/agents";
import strings from "./strings.json";
import type { AgentRequest } from "./useAgents";

const labels = {
	ready: strings.openclawRuntimeIndicator.statusReady,
	starting: strings.openclawRuntimeIndicator.statusStarting,
	stopping: strings.openclawRuntimeIndicator.statusStopping,
	error: strings.openclawRuntimeIndicator.statusError,
	stopped: strings.openclawRuntimeIndicator.statusStopped,
};
export function runtimeStatusLabel(runtime: RuntimeState): string {
	return runtime.available
		? labels[runtime.status]
		: "No agent runtime is installed";
}
export function RuntimeIndicator({
	runtime,
	request,
	large = false,
}: {
	readonly runtime: RuntimeState;
	readonly request: AgentRequest;
	readonly large?: boolean;
}) {
	const color =
		runtime.status === "ready"
			? "#4ade80"
			: runtime.status === "error"
				? "#f87171"
				: runtime.status === "starting" || runtime.status === "stopping"
					? "#f5b547"
					: "#8b8b94";
	return (
		<div className="mc-toolbar" data-runtime={runtime.status}>
			<span className="mc-badge" role="status">
				<span
					aria-hidden="true"
					style={{
						display: "inline-block",
						width: 8,
						height: 8,
						borderRadius: "50%",
						background: color,
						marginRight: 6,
					}}
				/>
				{runtimeStatusLabel(runtime)}
			</span>
			{(["start", "stop", "restart"] as const).map((action) => (
				<button
					type="button"
					className="mc-button"
					key={action}
					aria-label={strings.openclawRuntimeIndicator[action]}
					title={strings.openclawRuntimeIndicator[action]}
					disabled={
						!runtime.available ||
						(action === "start"
							? runtime.status === "ready" ||
								runtime.status === "starting" ||
								runtime.status === "stopping"
							: runtime.status !== "ready")
					}
					style={
						large
							? {
									width: 148,
									height: 84,
									borderRadius: 12,
									flexDirection: "column",
									gap: 8,
								}
							: { width: 28, height: 28, minHeight: 28, padding: 0 }
					}
					onClick={() => void request({ type: "runtime", action })}
				>
					<svg
						aria-hidden="true"
						width={large ? 26 : 16}
						height={large ? 26 : 16}
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.8"
					>
						{action === "start" ? (
							<path d="M7 4 20 12 7 20Z" />
						) : action === "stop" ? (
							<path d="M8 4v16M16 4v16" />
						) : (
							<>
								<path d="M20 7v6h-6" />
								<path d="M20 13a8 8 0 1 0-2 5M20 7l-3-3" />
							</>
						)}
					</svg>
					{large && strings.openclawRuntimeIndicator[action]}
				</button>
			))}
			{runtime.status === "error" && (
				<span role="alert">
					{runtime.operation === "stop"
						? strings.openclawRuntimeIndicator.stopFailed
						: runtime.operation === "restart"
							? strings.openclawRuntimeIndicator.restartFailed
							: strings.openclawRuntimeIndicator.startFailed}{" "}
					· {runtime.code}
				</span>
			)}
		</div>
	);
}
