import { Effect } from "effect";
import type { MediaProcess } from "./process";

const launchers = {
	apple: { bundle: "com.apple.Music", url: "https://music.apple.com/" },
	spotify: { bundle: "com.spotify.client", url: "https://open.spotify.com/" },
	qq: { bundle: "com.tencent.QQMusicMac", url: "https://y.qq.com/" },
	netease: { bundle: "com.netease.163music", url: "https://music.163.com/" },
} as const;
/** Closed catalog. No renderer-supplied application path or shell source. */
export const launchMediaPlayer = (
	platform: string,
	run: MediaProcess,
	id: keyof typeof launchers,
) => {
	const player = launchers[id];
	if (platform !== "darwin" && platform !== "win32")
		return Effect.succeed(false);
	return run(
		platform === "darwin" ? "/usr/bin/open" : "explorer.exe",
		platform === "darwin" ? ["-b", player.bundle] : [player.url],
	).pipe(
		Effect.as(true),
		Effect.catchTag("MediaProcessFailed", (error) =>
			Effect.logWarning(error).pipe(Effect.as(false)),
		),
	);
};
