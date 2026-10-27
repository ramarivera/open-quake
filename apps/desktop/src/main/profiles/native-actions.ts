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

/** Structured native host boundary. Tests inject this port without touching real apps. */
export interface NativeApplicationPort {
	readonly resolve?: (
		reference: string,
		signal?: AbortSignal,
	) => Promise<string>;
	readonly sameApplication?: (
		wanted: string,
		actual: string,
		signal?: AbortSignal,
	) => Promise<boolean>;
	readonly list: (
		signal?: AbortSignal,
	) => Promise<readonly { readonly pid: number; readonly path: string }[]>;
	readonly identity: (
		pid: number,
		signal?: AbortSignal,
	) => Promise<string | undefined>;
	readonly focus: (
		pid: number,
		path: string,
		signal?: AbortSignal,
	) => Promise<void>;
	readonly launch: (path: string) => Promise<void>;
	readonly terminate: (
		pid: number,
		force: boolean,
		signal?: AbortSignal,
	) => Promise<void>;
}
const exactApplication = (
	platform: ProfilePlatform,
	wanted: string,
	actual: string,
): boolean => {
	const normalize = (value: string) => {
		const path = value.replaceAll("\\", "/");
		const at = path.toLowerCase().indexOf(".app/");
		const bundle = at < 0 ? path : path.slice(0, at + 4);
		return platform === "win32" ? bundle.toLowerCase() : bundle;
	};
	return normalize(wanted) === normalize(actual);
};
export async function runApplicationAction(
	port: NativeApplicationPort,
	platform: ProfilePlatform,
	reference: string,
	action: "open" | "close",
	force = false,
	signal?: AbortSignal,
): Promise<void> {
	signal?.throwIfAborted();
	const resolved = port.resolve
		? await port.resolve(reference, signal)
		: reference;
	signal?.throwIfAborted();
	const same = (actual: string) =>
		port.sameApplication
			? port.sameApplication(resolved, actual, signal)
			: Promise.resolve(exactApplication(platform, resolved, actual));
	const matches: { readonly pid: number; readonly path: string }[] = [];
	for (const process of await port.list(signal))
		if (
			Number.isSafeInteger(process.pid) &&
			process.pid > 0 &&
			(await same(process.path))
		)
			matches.push(process);
	signal?.throwIfAborted();
	if (action === "open") {
		const match = matches[0];
		if (match) {
			const identity = await port.identity(match.pid, signal);
			signal?.throwIfAborted();
			if (identity && (await same(identity))) {
				await port.focus(match.pid, reference, signal);
				return;
			}
		}
		await port.launch(reference);
		return;
	}
	for (const match of matches) {
		const identity = await port.identity(match.pid, signal);
		signal?.throwIfAborted();
		if (identity && (await same(identity)))
			await port.terminate(match.pid, force, signal);
	}
}
