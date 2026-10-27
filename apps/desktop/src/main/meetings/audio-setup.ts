import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import {
	MeetingUnavailable,
	meetingError,
} from "../../../../../packages/edge/src/meetings/meeting-errors";
import type { AudioSetupReply } from "../../shared/audio-setup";

export interface AudioSetupPort {
	readonly platform: string;
	readonly mock: boolean;
	readonly active?: () => boolean;
	readonly confirm: () => Promise<boolean>;
	readonly select: () => Promise<string | undefined>;
	readonly openInstaller: (path: string) => Promise<void>;
}
/** User action only. The native port owns package validation and installer handoff. */
export function audioSetup(port: AudioSetupPort) {
	let busy = false;
	const reply = (state: AudioSetupReply["state"]): AudioSetupReply => ({
		platform: port.platform,
		state,
	});
	const status = () =>
		reply(
			port.mock
				? "mock"
				: port.platform === "darwin"
					? "available"
					: "unsupported",
		);
	return {
		status,
		install: Effect.fn("MeetingAudioSetup.install")(
			function* (): Effect.fn.Return<AudioSetupReply> {
				if (port.mock || port.platform !== "darwin") return status();
				if (busy) return reply("failed");
				busy = true;
				return yield* Effect.tryPromise({
					try: async () => {
						if (!(await port.confirm()) || port.active?.() === false)
							return reply("cancelled");
						const path = await port.select();
						if (!path || port.active?.() === false) return reply("cancelled");
						await port.openInstaller(path);
						return reply("opened");
					},
					catch: (cause) => new MeetingUnavailable(cause),
				}).pipe(
					Effect.catchTag("MeetingUnavailable", () =>
						Effect.succeed(reply("failed")),
					),
					Effect.ensuring(
						Effect.sync(() => {
							busy = false;
						}),
					),
				);
			},
		),
	};
}
const execute = promisify(execFile);
/** Copy a bounded, regular pkg into app-owned storage before signature checks.
 * Keep the copy after handoff: Installer may still be reading it after openPath returns. */
export async function openBlackHoleInstaller(options: {
	readonly selected: string;
	readonly root: string;
	readonly verify?: (path: string) => Promise<void>;
	readonly open: (path: string) => Promise<string>;
}): Promise<void> {
	if (!/^BlackHole[^/]*\.pkg$/i.test(basename(options.selected)))
		throw meetingError("Invalid");
	await mkdir(options.root, { recursive: true });
	const directory = await mkdtemp(join(options.root, "blackhole-"));
	let handedOff = false;
	try {
		const input = await open(
			options.selected,
			constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		);
		try {
			const stat = await input.stat();
			if (!stat.isFile() || stat.size < 1 || stat.size > 512 * 1024 * 1024)
				throw meetingError("Invalid");
			const output = await open(join(directory, "BlackHole.pkg"), "wx", 0o600);
			try {
				const buffer = Buffer.alloc(65536);
				let offset = 0;
				while (offset < stat.size) {
					const { bytesRead } = await input.read(
						buffer,
						0,
						Math.min(buffer.length, stat.size - offset),
						offset,
					);
					if (!bytesRead) throw meetingError("Invalid");
					await output.writeFile(buffer.subarray(0, bytesRead));
					offset += bytesRead;
				}
				await output.sync();
			} finally {
				await output.close();
			}
		} finally {
			await input.close();
		}
		const path = join(directory, "BlackHole.pkg");
		await (options.verify ?? verifyBlackHolePackage)(path);
		if (await options.open(path)) throw meetingError("Unavailable");
		handedOff = true;
	} finally {
		if (!handedOff) await rm(directory, { recursive: true, force: true });
	}
}
export async function verifyBlackHolePackage(
	path: string,
	run: (
		command: string,
		args: readonly string[],
	) => Promise<{ stdout: string }> = (command, args) =>
		execute(command, [...args], {
			timeout: 30000,
			env: { ...process.env, LC_ALL: "C" },
		}),
): Promise<void> {
	await run("/usr/sbin/spctl", ["--assess", "--type", "install", path]);
	const { stdout } = await run("/usr/sbin/pkgutil", [
		"--check-signature",
		path,
	]);
	if (
		!/Developer ID Installer: Existential Audio(?: Inc\.?)? \([A-Z0-9]{10}\)/.test(
			stdout,
		)
	)
		throw meetingError("Invalid");
}
