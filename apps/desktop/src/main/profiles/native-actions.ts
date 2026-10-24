import { spawn } from "node:child_process";
import type { OpenDialogOptions } from "electron";
import type { ProfilePlatform } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";

/** Resolve launch acceptance without waiting for a GUI application's lifetime. */
export const launchProfileCommand = (
	platform: ProfilePlatform,
	command: string,
): Promise<void> =>
	new Promise((resolve, reject) => {
		const child = spawn(
			platform === "win32" ? "cmd.exe" : "/bin/sh",
			platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command],
			{ detached: true, stdio: "ignore", windowsHide: true },
		);
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});

export const profileApplicationDialog = (
	platform: ProfilePlatform,
): OpenDialogOptions => ({
	title: "Application",
	properties: ["openFile"],
	...(platform === "linux"
		? {}
		: {
				filters: [
					{
						name: "Application",
						extensions: platform === "darwin" ? ["app"] : ["exe"],
					},
				],
			}),
});
