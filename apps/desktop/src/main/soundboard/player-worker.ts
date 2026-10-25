/** Installed only in the sandboxed playback window. It has no Node or microphone access. */
export function installSoundboardWorker(url: string) {
	const audio = new Audio();
	audio.preload = "auto";
	let failure: Error | undefined;
	let readyResolve: () => void;
	let readyReject: (cause: Error) => void;
	let endResolve: () => void;
	let endReject: (cause: Error) => void;
	const ready = new Promise<void>((resolve, reject) => {
		readyResolve = resolve;
		readyReject = reject;
	});
	const ended = new Promise<void>((resolve, reject) => {
		endResolve = resolve;
		endReject = reject;
	});
	// Native decode can fail before main subscribes to either promise.
	void ready.catch(() => undefined);
	void ended.catch(() => undefined);
	audio.oncanplay = () => readyResolve();
	audio.onended = () => endResolve();
	audio.onerror = () => {
		failure = new Error("Local audio decode failed");
		readyReject(failure);
		endReject(failure);
	};
	const check = () => {
		if (failure) throw failure;
	};
	Object.assign(globalThis, {
		__quakeSoundboard: {
			ready: () => ready,
			ended: () => ended,
			play: async () => {
				check();
				await audio.play();
			},
			pause: () => {
				check();
				audio.pause();
			},
			position: () => {
				check();
				return audio.currentTime * 1000;
			},
			gain: (value: number) => {
				check();
				if (!Number.isFinite(value) || value < 0 || value > 1)
					throw new Error("Invalid local audio gain");
				audio.volume = value;
			},
		},
	});
	audio.src = url;
	audio.load();
}

export const soundboardWorkerSource = (url: string): string =>
	`(${installSoundboardWorker.toString()})(${JSON.stringify(url)})`;
