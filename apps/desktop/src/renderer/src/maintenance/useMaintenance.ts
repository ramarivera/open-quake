import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type MaintenanceCommand,
	MaintenanceReply,
	type MaintenanceView,
	runningFirmware,
} from "../../../shared/maintenance-contracts";
import strings from "../../../shared/maintenance-strings.json";
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
				const raw: unknown = await window.quakeMaintenance.request(command);
				if (!mounted.current) return;
				if (!Schema.is(MaintenanceReply)(raw)) {
					setError("Settings response could not be read.");
					return;
				}
				if (!raw.ok) {
					setError(`The operation could not be completed (${raw.code}).`);
					return;
				}
				const next = raw.view;
				if (!reconciled.current) {
					reconciled.current = true;
					if (runningFirmware(next.firmware)) {
						visible.current = true;
						setDialog(true);
					}
				}
				lastState.current = next;
				setView(next);
				if (raw.message) setMessage(raw.message);
				if (
					["success", "failed", "needs_recovery"].includes(
						next.firmware.state,
					) &&
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
									next.firmware.reason,
								),
					);
				}
				last.current = next.firmware.state;
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
		[],
	);
	useEffect(() => {
		mounted.current = true;
		void request({ action: "read" });
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
		poll();
		const focus = () => {
			void request({ action: "read" });
		};
		window.addEventListener("focus", focus);
		return () => {
			mounted.current = false;
			clearTimeout(timer);
			window.removeEventListener("focus", focus);
		};
	}, [request]);
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
