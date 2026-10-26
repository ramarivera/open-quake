import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type FirmwareSnapshot,
	type MaintenanceCommand,
	MaintenanceReply,
	type MaintenanceView,
	runningFirmware,
} from "../../../shared/maintenance-contracts";
import strings from "../../../shared/maintenance-strings.json";
import { firmwareReason } from "./firmware-guidance";
export function useMaintenance() {
	const [view, setView] = useState<MaintenanceView>();
	const [error, setError] = useState("");
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [dialog, setDialog] = useState(false);
	const [toast, setToast] = useState("");
	const mounted = useRef(true);
	const pending = useRef(false);
	const last = useRef("");
	const visible = useRef(false);
	const lastState = useRef<MaintenanceView | undefined>(undefined);
	const reconciled = useRef(false);
	const progressRevision = useRef(0);
	const apply = useCallback((next: MaintenanceView) => {
		if (!reconciled.current) {
			reconciled.current = true;
			if (next.firmware.state !== "idle") {
				visible.current = true;
				setDialog(true);
			}
		}
		lastState.current = next;
		setView(next);
		if (
			["success", "failed", "needs_recovery"].includes(next.firmware.state) &&
			last.current !== next.firmware.state &&
			!visible.current
		) {
			setToast(
				next.firmware.state === "success"
					? strings.firmwareUpgrade.toast.success.replace(
							"{version}",
							next.firmware.to,
						)
					: strings.firmwareUpgrade.toast.failed.replace(
							"{reason}",
							firmwareReason(next.firmware.reason, next.firmware.from),
						),
			);
		}
		last.current = next.firmware.state;
	}, []);
	const request = useCallback(
		async (command: MaintenanceCommand): Promise<void> => {
			if (!window.quakeMaintenance) {
				if (mounted.current)
					setError("Settings are unavailable. Reopen the desktop app.");
				return;
			}
			if (command.action === "read" && pending.current) return;
			const mutation = command.action !== "read";
			if (mutation) {
				if (pending.current) return;
				if (
					command.action === "firmware-start" ||
					command.action === "firmware-recover"
				)
					setToast("");
				pending.current = true;
				setBusy(true);
				setError("");
				setMessage("");
			}
			try {
				const revision = progressRevision.current;
				const raw: unknown = await window.quakeMaintenance.request(command);
				if (!mounted.current) return;
				if (!Schema.is(MaintenanceReply)(raw)) {
					setError("Settings response could not be read.");
					return;
				}
				if (!raw.ok) {
					setError(
						raw.code.startsWith("QUAKE.FIRMWARE.")
							? firmwareReason(raw.code)
							: raw.code === "QUAKE.APP.UPDATE_FAILED"
								? "Upgrade failed, please retry later."
								: `The operation could not be completed (${raw.code}).`,
					);
					return;
				}
				apply(
					revision !== progressRevision.current && lastState.current
						? { ...raw.view, firmware: lastState.current.firmware }
						: raw.view,
				);
				if (raw.message) setMessage(raw.message);
			} catch {
				if (mounted.current)
					setError("Settings could not be reached. Try again.");
			} finally {
				if (mutation) {
					pending.current = false;
					if (mounted.current) setBusy(false);
				}
			}
		},
		[apply],
	);
	useEffect(() => {
		mounted.current = true;
		let timer: ReturnType<typeof setTimeout>;
		const poll = () => {
			if (!mounted.current) return;
			timer = setTimeout(
				() => {
					void request({ action: "read" }).finally(poll);
				},
				lastState.current && runningFirmware(lastState.current.firmware)
					? 1000
					: 2000,
			);
		};
		void request({ action: "read" }).finally(poll);
		const focus = () => {
			void request({ action: "read" });
		};
		window.addEventListener("focus", focus);
		const unsubscribe = window.quakeMaintenance?.subscribeFirmware?.(
			(firmware: FirmwareSnapshot) => {
				if (!mounted.current || !lastState.current) return;
				progressRevision.current++;
				apply({ ...lastState.current, firmware });
				if (!runningFirmware(firmware)) void request({ action: "read" });
			},
		);
		return () => {
			mounted.current = false;
			unsubscribe?.();
			clearTimeout(timer);
			window.removeEventListener("focus", focus);
		};
	}, [request, apply]);
	useEffect(() => {
		if (!toast) return;
		const timer = setTimeout(() => setToast(""), 6000);
		return () => clearTimeout(timer);
	}, [toast]);
	return {
		view,
		error,
		message,
		busy,
		dialog,
		toast,
		request,
		openDialog: () => {
			visible.current = true;
			setDialog(true);
		},
		closeDialog: () => {
			visible.current = false;
			setDialog(false);
			void request({ action: "firmware-close" });
		},
	};
}
export type MaintenanceController = ReturnType<typeof useMaintenance>;
