import type { FirmwareSnapshot } from "../../../shared/maintenance-contracts";
import strings from "../../../shared/maintenance-strings.json";

const fw = strings.firmwareUpgrade;
const reasons: Readonly<Record<string, string>> = {
	"QUAKE.FIRMWARE.IMAGE_INVALID":
		"The firmware image is invalid. Select a trusted QUAKE UF2 image.",
	"QUAKE.FIRMWARE.TARGET_MISMATCH":
		"The image does not match a trusted QUAKE release. Select a compatible image before continuing.",
	"QUAKE.FIRMWARE.VOLUME_INVALID":
		"The boot drive changed or is not a QUAKE bootloader. Reconnect the intended device and select its QUAKE DFU drive.",
	"QUAKE.FIRMWARE.WRITE_FAILED": fw.error.copy_failed,
	"QUAKE.FIRMWARE.VERIFICATION_FAILED": fw.error.verify_timeout,
	"QUAKE.FIRMWARE.UNAVAILABLE": fw.error.device_disconnected,
	"QUAKE.FIRMWARE.BUSY":
		"A firmware update is already running. Reopen it to see its progress.",
	"QUAKE.FIRMWARE.PERSIST_FAILED":
		"The recovery record could not be saved. Check available disk space and access before starting again.",
	interrupted:
		"The app stopped during an update. The device firmware has not been verified.",
	cancelled_before_write:
		"Writing was cancelled before any bytes were copied. The device may still be in download mode.",
};
export function firmwareReason(
	reason: string,
	current = "",
	expected = "",
): string {
	return (
		reasons[reason] ??
		Object.entries(fw.error).find(([key]) => key === reason)?.[1] ??
		"The firmware update could not finish. Reconnect the intended QUAKE and inspect a trusted image before trying again."
	)
		.replace("{current}", current)
		.replace("{expected}", expected);
}
export function firmwareHint(snapshot: FirmwareSnapshot): string {
	if (snapshot.state === "success")
		return fw.success.replace("{version}", snapshot.to);
	if (snapshot.state === "needs_recovery")
		return `${firmwareReason(snapshot.reason, snapshot.from, snapshot.to)} Update unverified. Reconnect the intended QUAKE, enter its bootloader manually, and select the trusted image again. Do not unplug during writing.`;
	if (snapshot.state === "failed")
		return firmwareReason(snapshot.reason, snapshot.from, snapshot.to);
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
