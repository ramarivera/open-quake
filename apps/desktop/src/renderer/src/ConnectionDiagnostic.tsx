import { useCallback, useContext, useEffect, useState } from "react";
import type {
	ConnectionDiagnostic,
	LifecycleBridge,
	LifecycleCommand,
} from "../../shared/lifecycle-contracts";
import strings from "../../shared/lifecycle-strings.json";
import "./connectionDiagnostic.css";
import { PageSectionContext } from "./ui/Form";

declare global {
	interface Window {
		readonly quakeLifecycle?: LifecycleBridge;
	}
}
const text = strings.quakeDiagnostic;
const unavailable: ConnectionDiagnostic = {
	usb: "fail",
	hdmi: "fail",
	checking: false,
	mock: false,
	width: 0,
	height: 0,
	resolutionMismatch: false,
	issue: "unavailable",
};
export function hdmiMessage(status: ConnectionDiagnostic): string {
	return status.resolutionMismatch
		? text.check.hdmi.failResolution
				.replace("{width}", String(status.width))
				.replace("{height}", String(status.height))
		: status.hdmi === "pass"
			? text.check.hdmi.pass
			: text.check.hdmi.fail;
}
export function DiagnosticView({
	status,
	notice,
	run,
	displaySettingsAvailable = false,
	layoutRepairAvailable = false,
}: {
	status: ConnectionDiagnostic | undefined;
	notice: string;
	run: (action: Exclude<LifecycleCommand["action"], "wizard">) => void;
	displaySettingsAvailable?: boolean;
	layoutRepairAvailable?: boolean;
}): React.JSX.Element {
	const [expanded, setExpanded] = useState<"usb" | "hdmi">("usb");
	useEffect(() => {
		if (status && !status.checking)
			setExpanded(status.usb === "fail" ? "usb" : "hdmi");
	}, [status]);
	// Inside the management shell the kicker names the navigation section.
	const section = useContext(PageSectionContext);
	const checking = !status || status.checking;
	const ready =
		status?.usb === "pass" && status.hdmi === "pass" && status.issue === "none";
	return (
		<section className="connection-check" aria-labelledby="connection-title">
			<header>
				<p className="connection-eyebrow">{section ?? text.eyebrow}</p>
				<h1 id="connection-title">{text.title}</h1>
				<p className="muted">{text.subtitle}</p>
			</header>
			{status?.issue === "native-failed" && (
				<p role="alert">
					Quake display arrangement failed. Automatic layout prompts are paused
					for 10 minutes. Open Display Settings to adjust the layout, or try
					Arrange Quake display again.
				</p>
			)}
			{status?.mock && (
				<p className="muted">
					Desktop preview uses a simulated USB connection.
				</p>
			)}
			<div className="connection-checks" aria-busy={checking}>
				{(["usb", "hdmi"] as const).map((channel) => {
					const pass = status?.[channel] === "pass";
					const copy = text.check[channel];
					const steps =
						channel === "usb"
							? text.check.usb.steps
							: status?.resolutionMismatch
								? text.check.hdmi.resolutionSteps
								: text.check.hdmi.steps;
					return (
						<section key={channel}>
							<button
								type="button"
								className="connection-summary"
								aria-expanded={expanded === channel}
								aria-controls={`connection-${channel}`}
								onClick={() => setExpanded(channel)}
							>
								<span className="connection-port" aria-hidden="true">
									{channel.toUpperCase()}
								</span>
								<span>
									<strong>{copy.label}</strong>
									<span className="connection-state" data-pass={pass}>
										{checking
											? text.check.checking
											: channel === "hdmi" && status
												? hdmiMessage(status)
												: pass
													? copy.pass
													: copy.fail}
									</span>
								</span>
								<span aria-hidden="true">
									{expanded === channel ? "−" : "+"}
								</span>
							</button>
							{expanded === channel && !checking && (
								<div
									id={`connection-${channel}`}
									className="connection-details"
								>
									{pass ? (
										<p>{text.check.passDetails}</p>
									) : (
										<div role="alert">
											<h3>{text.troubleshootingTitle}</h3>
											<ol>
												{Object.values(steps).map((step) => (
													<li key={step}>{step}</li>
												))}
											</ol>
										</div>
									)}
								</div>
							)}
						</section>
					);
				})}
			</div>
			<div className="connection-actions">
				<button
					type="button"
					disabled={checking}
					onClick={() => run("redetect")}
				>
					{checking ? text.action.checking : text.action.recheck}
				</button>
				{displaySettingsAvailable && (
					<button type="button" onClick={() => run("display-settings")}>
						{strings.displayMode.openDisplaySettings}
					</button>
				)}
				{layoutRepairAvailable && !status?.mock && status?.hdmi === "pass" && (
					<button
						type="button"
						disabled={checking}
						onClick={() => run("repair-layout")}
					>
						Arrange Quake display…
					</button>
				)}
			</div>
			<p role="status" aria-live="polite">
				{notice || (ready ? text.toast.allPass : "")}
			</p>
			{!ready && (
				<p className="muted">
					Desktop preview is available from Screen while you check the
					connections.
				</p>
			)}
		</section>
	);
}
export function ConnectionCheck({
	onReady,
}: {
	onReady?: (ready: boolean) => void;
} = {}): React.JSX.Element {
	const [status, setStatus] = useState<ConnectionDiagnostic>();
	const [notice, setNotice] = useState("");
	const run = useCallback(
		async (
			action: Exclude<LifecycleCommand["action"], "wizard">,
		): Promise<void> => {
			const bridge = window.quakeLifecycle;
			if (!bridge) {
				setStatus(unavailable);
				setNotice(text.toast.checkError);
				return;
			}
			if (action === "redetect") {
				setStatus((old) => old && { ...old, checking: true });
				setNotice(text.toast.recheckStart);
			}
			try {
				const reply = await bridge.request({ action });
				if (reply.ok) {
					setStatus(reply.status);
					if (action === "redetect")
						setNotice(
							reply.status.issue !== "none"
								? text.toast.checkError
								: reply.status.usb === "pass" && reply.status.hdmi === "pass"
									? text.toast.allPass
									: text.toast.recheckDone.replace(
											"{completed}",
											String(
												Number(reply.status.usb === "pass") +
													Number(reply.status.hdmi === "pass"),
											),
										),
						);
				} else {
					setStatus((old) => ({ ...(old ?? unavailable), checking: false }));
					setNotice(text.toast.checkError);
				}
			} catch {
				setStatus((old) => ({ ...(old ?? unavailable), checking: false }));
				setNotice(text.toast.checkError);
			}
		},
		[],
	);
	useEffect(() => {
		const off = window.quakeLifecycle?.onStatus((next) => {
			setStatus(next);
			if (!next.checking)
				setNotice(
					next.issue !== "none"
						? text.toast.checkError
						: next.usb === "pass" && next.hdmi === "pass"
							? text.toast.allPass
							: text.toast.recheckDone.replace(
									"{completed}",
									String(
										Number(next.usb === "pass") + Number(next.hdmi === "pass"),
									),
								),
				);
		});
		void run("read");
		return off;
	}, [run]);
	useEffect(() => {
		onReady?.(
			!!status &&
				!status.checking &&
				status.usb === "pass" &&
				status.hdmi === "pass" &&
				status.issue === "none",
		);
	}, [status, onReady]);
	return (
		<DiagnosticView
			status={status}
			notice={notice}
			displaySettingsAvailable={
				window.quakeLifecycle?.displaySettingsAvailable ?? false
			}
			layoutRepairAvailable={
				window.quakeLifecycle?.layoutRepairAvailable ?? false
			}
			run={(action) => {
				void run(action);
			}}
		/>
	);
}
