import { Schema } from "effect";
import { useEffect, useState } from "react";
import { ServiceSettings } from "../../../../../../../packages/edge/src/agents/service-settings-contracts";
import type { AgentView } from "../../../../shared/agents";
import { useAgentsCopy } from "./copy";
import type { AgentRequest } from "./useAgents";
export function AdministrationPanel({
	active = true,
	view,
	request,
	busy,
}: {
	readonly active?: boolean;
	readonly view: AgentView;
	readonly request: AgentRequest;
	readonly busy: boolean;
}) {
	const copy = useAgentsCopy().administration;
	const [settings, setSettings] = useState<typeof ServiceSettings.Type>();
	const [unavailable, setUnavailable] = useState("");
	const [restart, setRestart] = useState(false);
	const [clear, setClear] = useState(false);
	const [pack, setPack] = useState("");
	const [backup, setBackup] = useState("");
	const [agent, setAgent] = useState(
		view.agents.find((a) => a.id !== "main")?.id ?? "main",
	);
	const [result, setResult] = useState("");
	useEffect(() => {
		let mounted = true;
		if (!active) return;
		setUnavailable("");
		setSettings(undefined);
		if (!view.runtime.available) {
			setUnavailable(copy.unsupported);
			return;
		}
		const load = () =>
			request({ type: "service-settings" }).then((reply) => {
				if (!mounted) return;
				if (reply._tag === "rejected") setUnavailable(reply.message);
				else {
					const decoded = Schema.decodeUnknownEither(
						Schema.parseJson(ServiceSettings),
					)(reply.draft);
					if (decoded._tag === "Right") setSettings(decoded.right);
					else setUnavailable(copy.invalidSettings);
				}
			});
		void load();
		const reload = () => {
			void load();
		};
		window.addEventListener("agents:settings-invalidated", reload);
		return () => {
			mounted = false;
			window.removeEventListener("agents:settings-invalidated", reload);
		};
	}, [
		active,
		request,
		copy.invalidSettings,
		copy.unsupported,
		view.runtime.available,
	]);
	return (
		<section className="mc-panel aw-form" aria-label={copy.title}>
			<h2>{copy.title}</h2>
			{unavailable && <p role="status">{unavailable}</p>}
			{settings && (
				<form
					className="aw-form"
					onSubmit={(event) => {
						event.preventDefault();
						void request({
							type: "save-service-settings",
							settings,
							restart,
							revision: view.revision,
						}).then((reply) =>
							setResult(reply._tag === "success" ? copy.saved : reply.message),
						);
					}}
				>
					<label className="mc-field">
						{copy.port}
						<input
							type="number"
							min={1}
							max={65535}
							required
							value={settings.port}
							onChange={(e) =>
								setSettings({ ...settings, port: Number(e.target.value) })
							}
						/>
					</label>
					<label className="mc-field">
						{copy.logLevel}
						<select
							value={settings.logLevel}
							onChange={(e) => {
								const value = e.target.value;
								if (
									value === "debug" ||
									value === "info" ||
									value === "warn" ||
									value === "error"
								)
									setSettings({ ...settings, logLevel: value });
							}}
						>
							{["debug", "info", "warn", "error"].map((level) => (
								<option key={level}>{level}</option>
							))}
						</select>
					</label>
					<label>
						<input
							type="checkbox"
							checked={settings.autoStart}
							onChange={(e) =>
								setSettings({ ...settings, autoStart: e.target.checked })
							}
						/>
						{copy.autoStart}
					</label>
					<label className="mc-field">
						{copy.directory}
						<input
							value={settings.dataDirectory}
							onChange={(e) =>
								setSettings({ ...settings, dataDirectory: e.target.value })
							}
						/>
					</label>
					<p className="cw-muted">{copy.ownedDirectory}</p>
					<label>
						<input
							type="checkbox"
							checked={restart}
							onChange={(e) => setRestart(e.target.checked)}
						/>
						{copy.restart}
					</label>
					<button
						type="submit"
						className="mc-button"
						disabled={busy || !Schema.is(ServiceSettings)(settings)}
					>
						{copy.save}
					</button>
					<button
						type="button"
						className="mc-button"
						disabled={busy || view.runtime.status !== "stopped"}
						onClick={() => setClear(true)}
					>
						{copy.clear}
					</button>
					{clear && (
						<div role="alertdialog" aria-label={copy.clear}>
							<p>{copy.confirmClear}</p>
							<button
								type="button"
								className="mc-button"
								onClick={() => setClear(false)}
							>
								{copy.cancel}
							</button>
							<button
								type="button"
								className="mc-button"
								disabled={busy}
								onClick={() =>
									void request({
										type: "clear-runtime-data",
										confirmed: true,
										revision: view.revision,
									}).then((reply) => {
										setResult(
											reply._tag === "success" ? copy.cleared : reply.message,
										);
										if (reply._tag === "success") setClear(false);
									})
								}
							>
								{copy.confirm}
							</button>
						</div>
					)}
				</form>
			)}
			<details>
				<summary>{copy.portable}</summary>
				<label className="mc-field">
					{copy.agent}
					<select value={agent} onChange={(e) => setAgent(e.target.value)}>
						{view.agents.map((a) => (
							<option key={a.id} value={a.id}>
								{a.name}
							</option>
						))}
					</select>
				</label>
				<button
					type="button"
					className="mc-button"
					disabled={busy}
					onClick={() =>
						void request({ type: "export-pack", id: agent }).then((reply) => {
							if (reply._tag === "success") setPack(reply.draft);
							else setResult(reply.message);
						})
					}
				>
					{copy.export}
				</button>
				<label className="mc-field">
					{copy.pack}
					<textarea
						rows={8}
						maxLength={2097152}
						value={pack}
						onChange={(e) => setPack(e.target.value)}
					/>
				</label>
				<button
					type="button"
					className="mc-button"
					disabled={busy || !pack.trim()}
					onClick={() =>
						void request({
							type: "import-pack",
							pack,
							revision: view.revision,
						}).then((reply) =>
							setResult(
								reply._tag === "success" ? copy.imported : reply.message,
							),
						)
					}
				>
					{copy.import}
				</button>
			</details>
			<button
				type="button"
				className="mc-button"
				disabled={busy}
				onClick={() =>
					void request({ type: "export-workspace-backup" }).then((reply) => {
						if (reply._tag === "success") setBackup(reply.draft);
						else setResult(reply.message);
					})
				}
			>
				{copy.backup}
			</button>
			{backup && (
				<label className="mc-field">
					{copy.backupData}
					<textarea readOnly rows={8} value={backup} />
				</label>
			)}

			<button
				type="button"
				className="mc-button"
				disabled={busy}
				onClick={() =>
					void request({ type: "diagnostics" }).then((reply) =>
						setResult(reply._tag === "success" ? reply.draft : reply.message),
					)
				}
			>
				{copy.diagnostics}
			</button>
			{result && <output className="aw-message">{result}</output>}
		</section>
	);
}
