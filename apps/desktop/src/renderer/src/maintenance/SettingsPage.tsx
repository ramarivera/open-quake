import { Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import {
	type FirmwareSnapshot,
	newerVersion,
	type PermissionKey,
	RecoverySerial,
	runningFirmware,
} from "../../../shared/maintenance-contracts";
import strings from "../../../shared/maintenance-strings.json";
import { Group, PageHeader, Row } from "../ui/Form";
import type { MaintenanceController } from "./useMaintenance";
import "./maintenance.css";

const fw = strings.firmwareUpgrade;
const permissionNames: Readonly<Record<PermissionKey, string>> = {
	accessibility: strings.permissions.nameAccessibility,
	inputMonitoring: strings.permissions.nameInputMonitoring,
	microphone: strings.permissions.nameMicrophone,
	screenRecording: strings.permissions.nameScreenRecording,
	systemAudio: strings.permissions.nameSystemAudio,
};
export function SettingsPage({
	controller: c,
}: {
	controller: MaintenanceController;
}): React.JSX.Element {
	const [reset, setReset] = useState(false);
	const [recoverySerial, setRecoverySerial] = useState("");
	const view = c.view;
	const running = view ? runningFirmware(view.firmware) : false;
	return (
		<div className="maintenance-settings">
			<PageHeader title="Settings" />
			{c.error ? (
				<p role="alert" className="maintenance-error">
					{c.error}
				</p>
			) : null}
			{c.message ? <p role="status">{c.message}</p> : null}
			{!view ? (
				<p role="status">Loading settings…</p>
			) : (
				<>
					<Group title="Device">
						<Row
							label="Firmware Version"
							hint={
								!view.serial
									? fw.rowStatus.deviceOffline
									: running
										? fw.rowStatus.upgradingInBackground
										: "Manual firmware updates"
							}
						>
							<span className="firmware-version">
								{view.currentVersion || "--"}
								{view.imageVersion &&
								newerVersion(view.imageVersion, view.currentVersion)
									? ` → ${view.imageVersion}`
									: ""}
							</span>
							{running || view.firmware.state !== "idle" ? (
								<button type="button" className="button" onClick={c.openDialog}>
									View upgrade
								</button>
							) : null}
						</Row>
						<Row
							label="Firmware image"
							hint={
								view.imageTrusted
									? "Trusted QUAKE image verified"
									: "Select a trusted QUAKE UF2 image to inspect it."
							}
						>
							<button
								type="button"
								className="button"
								disabled={c.busy || running}
								onClick={() => void c.request({ action: "firmware-inspect" })}
							>
								Select UF2…
							</button>
							{view.imageTrusted &&
							newerVersion(view.imageVersion, view.currentVersion) ? (
								<button
									type="button"
									className="button button-primary"
									disabled={c.busy || running || !view.serial}
									onClick={() => {
										c.openDialog();
										void c.request({ action: "firmware-start" });
									}}
								>
									{fw.upgradeButton}
								</button>
							) : null}
						</Row>
						{view.imageTrusted && !running ? (
							<Row
								label="Bootloader recovery"
								hint="For a QUAKE already in download mode. Enter its exact serial; completion still requires version readback from that device."
							>
								<label>
									Device serial{" "}
									<input
										aria-label="Recovery device serial"
										value={recoverySerial}
										placeholder={
											view.firmware.serial || view.serial || "Device serial"
										}
										onChange={(event) => setRecoverySerial(event.target.value)}
										maxLength={128}
									/>
								</label>
								<button
									type="button"
									className="button"
									disabled={
										c.busy || !Schema.is(RecoverySerial)(recoverySerial)
									}
									onClick={() => {
										c.openDialog();
										void c.request({
											action: "firmware-recover",
											serial: recoverySerial,
										});
									}}
								>
									Recover from bootloader
								</button>
							</Row>
						) : null}
					</Group>
					<Group title="General">
						<Row
							label="Version"
							hint={
								view.update.state === "disabled"
									? "App updates are not configured for this build."
									: view.update.state.replaceAll("_", " ")
							}
						>
							<span>{view.appVersion}</span>
							<button
								type="button"
								className="button"
								disabled={
									c.busy ||
									["checking", "downloading", "installing"].includes(
										view.update.state,
									)
								}
								onClick={() => void c.request({ action: "check-update" })}
							>
								{strings.checkUpdate}
							</button>
						</Row>
						<Row
							label={strings.resourcesManage}
							hint="Encrypted ZIP compatible with DK-Suite. Import merges profiles and resources, then exits."
						>
							<button
								type="button"
								className="button"
								disabled={c.busy || running}
								onClick={() => void c.request({ action: "import" })}
							>
								{strings.importResources}
							</button>
							<button
								type="button"
								className="button"
								disabled={c.busy}
								onClick={() => void c.request({ action: "export" })}
							>
								{strings.exportResources}
							</button>
						</Row>
					</Group>
					{view.macOS ? (
						<Group
							title={strings.permissions.sectionTitle}
							description="Live permission status. Open Settings to change access; restart the app after granting Accessibility."
						>
							{view.permissions.map((permission) => (
								<Row
									key={permission.key}
									label={permissionNames[permission.key]}
								>
									<span
										className="permission-status"
										data-status={permission.status}
									>
										<span aria-hidden="true">●</span>{" "}
										{permission.status[0]?.toUpperCase()}
										{permission.status.slice(1)}
									</span>
									<button
										type="button"
										className="button"
										disabled={c.busy}
										onClick={() =>
											void c.request({
												action: "permission",
												key: permission.key,
											})
										}
										aria-label={`Open ${permissionNames[permission.key]} settings`}
									>
										Open Settings
									</button>
								</Row>
							))}
						</Group>
					) : null}
					<div className="maintenance-danger">
						<button
							type="button"
							className="button"
							disabled={c.busy || running}
							onClick={() => setReset(true)}
						>
							{strings.clearAllData}
						</button>
					</div>
				</>
			)}
			{reset ? (
				<ResetDialog
					onClose={() => setReset(false)}
					onReset={(backup) => {
						setReset(false);
						void c.request({ action: "reset", backup });
					}}
				/>
			) : null}
		</div>
	);
}
function Modal({
	label,
	onClose,
	children,
}: {
	label: string;
	onClose: () => void;
	children: React.ReactNode;
}): React.JSX.Element {
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const element = dialog.current;
		element?.showModal();
		return () => element?.close();
	}, []);
	return (
		<dialog
			className="maintenance-dialog"
			aria-label={label}
			ref={dialog}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
		>
			{children}
		</dialog>
	);
}
function ResetDialog({
	onClose,
	onReset,
}: {
	onClose: () => void;
	onReset: (backup: boolean) => void;
}): React.JSX.Element {
	return (
		<Modal label="Hint" onClose={onClose}>
			<h2>Hint</h2>
			<p>{strings.clearAllDataConfirm}</p>
			<footer>
				<button type="button" className="button" onClick={onClose}>
					{strings.clearAllDataCancel}
				</button>
				<button
					type="button"
					className="button button-primary"
					onClick={() => onReset(true)}
				>
					{strings.clearAllDataBackup}
				</button>
				<button
					type="button"
					className="button danger"
					onClick={() => onReset(false)}
				>
					{strings.clearAllDataWithoutBackup}
				</button>
			</footer>
		</Modal>
	);
}
export function firmwareHint(snapshot: FirmwareSnapshot): string {
	if (snapshot.state === "success")
		return fw.success.replace("{version}", snapshot.to);
	if (snapshot.state === "needs_recovery")
		return "Update unverified. Reconnect the intended QUAKE, enter its bootloader manually, and select the trusted image again. Do not unplug during writing.";
	if (snapshot.state === "failed")
		return (
			Object.entries(fw.error).find(([key]) => key === snapshot.reason)?.[1] ??
			`Firmware upgrade failed (${snapshot.reason}).`
		);
	const hints: Readonly<Record<string, string>> = {
		checking: fw.hint.checking,
		entering_download_mode: fw.hint.enteringDownloadMode,
		waiting_volume: fw.hint.waitingVolume,
		ready_to_write: "Select the QUAKE DFU drive and confirm writing firmware.",
		copying: fw.hint.copying,
		written_unverified: fw.hint.verifying,
		verifying: fw.hint.verifying,
	};
	return hints[snapshot.state] ?? fw.hint.checking;
}
export function FirmwareDialog({
	controller: c,
}: {
	controller: MaintenanceController;
}): React.JSX.Element | null {
	if (!c.dialog || !c.view) return null;
	const snapshot = c.view.firmware;
	const running = runningFirmware(snapshot);
	const failed = ["failed", "needs_recovery"].includes(snapshot.state);
	const labels = Object.values(fw.step);
	const ratio = snapshot.total
		? Math.round((snapshot.copied / snapshot.total) * 100)
		: 0;
	return (
		<Modal label={fw.dialogTitle} onClose={c.closeDialog}>
			<header>
				<h2>{fw.dialogTitle}</h2>
				<button
					type="button"
					className="button"
					onClick={c.closeDialog}
					aria-label="Close firmware upgrade"
				>
					×
				</button>
			</header>
			<div className="firmware-version">
				{snapshot.from || c.view.currentVersion || "--"} →{" "}
				{snapshot.to || c.view.imageVersion || "--"}
			</div>
			<p className="firmware-filename">
				{snapshot.fileName || "Select a trusted UF2 image"}
			</p>
			{snapshot.serial ? <p>Device serial: {snapshot.serial}</p> : null}
			<ol className="firmware-steps">
				{labels.map((label, index) => {
					const state =
						snapshot.state === "success" || index < snapshot.step
							? "done"
							: index === snapshot.step
								? failed
									? "failed"
									: "active"
								: "pending";
					return (
						<li key={label} data-state={state}>
							<span aria-hidden="true">
								{{ done: "✓", active: "●", failed: "✕", pending: "○" }[state]}
							</span>
							<span>{label}</span>
							<small>{fw.stepState[state]}</small>
						</li>
					);
				})}
			</ol>
			{["copying", "success", "failed", "needs_recovery"].includes(
				snapshot.state,
			) ? (
				<progress
					max={100}
					value={ratio}
					aria-label="Firmware write progress"
				/>
			) : (
				<div
					className="firmware-indeterminate"
					role="progressbar"
					aria-label={fw.hint.waiting}
				>
					<span />
				</div>
			)}
			<p className="firmware-filename">
				{snapshot.total
					? `${(snapshot.copied / 1048576).toFixed(1)} / ${(snapshot.total / 1048576).toFixed(1)} MB · ${ratio}%`
					: fw.hint.waiting}
			</p>
			<p role="status" className={failed ? "maintenance-error" : ""}>
				{firmwareHint(snapshot)}
			</p>
			{c.error ? (
				<p role="alert" className="maintenance-error">
					{c.error}
				</p>
			) : null}
			{running ? (
				<p className="firmware-subhint">{fw.hint.closeKeepsRunning}</p>
			) : failed ? (
				<p className="firmware-subhint">{fw.errorHint.retryAfterClose}</p>
			) : null}
			{snapshot.state === "ready_to_write" ? (
				<div className="firmware-volumes">
					{snapshot.volumes.map((volume) => (
						<button
							type="button"
							className="button button-primary"
							key={volume.id}
							disabled={c.busy}
							onClick={() =>
								void c.request({
									action: "firmware-write",
									volumeId: volume.id,
								})
							}
						>
							Write to {volume.label}
						</button>
					))}
					<button
						type="button"
						className="button"
						disabled={c.busy}
						onClick={() => void c.request({ action: "firmware-cancel" })}
					>
						Cancel before write
					</button>
				</div>
			) : null}
			<footer>
				<button type="button" className="button" onClick={c.closeDialog}>
					{fw.close}
				</button>
			</footer>
		</Modal>
	);
}
export function AppUpdateDialog({
	controller: c,
}: {
	controller: MaintenanceController;
}): React.JSX.Element | null {
	const update = c.view?.update;
	if (
		!update?.prompt ||
		!["available", "ready", "downloading", "failed"].includes(update.state)
	)
		return null;
	return (
		<Modal
			label="Newer version available"
			onClose={() => void c.request({ action: "defer-update" })}
		>
			<h2>Newer version available</h2>
			<p>Newer version available {update.version} Upgrade now?</p>
			{update.state === "downloading" ? (
				<progress value={update.progress} max={1} />
			) : null}
			{update.reason ? <p role="alert">{update.reason}</p> : null}
			<footer>
				<button
					type="button"
					className="button"
					onClick={() => void c.request({ action: "defer-update" })}
				>
					Install Later
				</button>
				<button
					type="button"
					className="button button-primary"
					disabled={c.busy}
					onClick={() =>
						void c.request({
							action:
								update.state === "ready" ? "install-update" : "download-update",
						})
					}
				>
					Install Now
				</button>
			</footer>
		</Modal>
	);
}
