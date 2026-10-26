import type {
	CaptureRequest,
	MeetingsBridge,
} from "../../../shared/meeting-bridge";
import { recoverMicrophone } from "../../../shared/speech";

class SystemAudioUnavailable extends Error {}

interface Session {
	readonly streams: readonly MediaStream[];
	readonly ownsStreams: boolean;
	recorders: MediaRecorder[];
	segment: number;
	timer: ReturnType<typeof setInterval>;
	pending: Promise<void>;
	rotation: Promise<void>;
	queuedBytes: number;
	failed: boolean;
}
/** Separate recorders share main streams. Only their owner can release the tracks. */
export function createMeetingCapture(
	bridge: MeetingsBridge,
	media: Pick<MediaDevices, "getUserMedia" | "getDisplayMedia"> &
		Partial<Pick<MediaDevices, "enumerateDevices">> = navigator.mediaDevices,
) {
	const sessions = new Map<string, Session>();
	const cancelled = new Set<string>();
	let system: MediaStream | undefined;
	let translationContext: AudioContext | undefined;
	let translationOwnsStream = false;
	let translationStream: MediaStream | undefined;
	let translationGeneration = 0;
	let pcmQueue = Promise.resolve();
	let disposed = false;
	const release = (streams: readonly MediaStream[]) => {
		for (const stream of streams)
			for (const track of stream.getTracks()) track.stop();
	};
	const beginRecorders = (id: string, session: Session): void => {
		session.recorders = session.streams.map((stream, index) => {
			const recorder = new MediaRecorder(stream, {
				mimeType: "audio/webm;codecs=opus",
			});
			const segment = session.segment;
			recorder.ondataavailable = (event) => {
				if (!event.data.size) return;
				if (session.queuedBytes + event.data.size > 16 * 1024 * 1024) {
					session.failed = true;
					bridge.sourceLost(id);
					return;
				}
				session.queuedBytes += event.data.size;
				session.pending = session.pending
					.then(async () => {
						await bridge.writeChunk({
							id,
							track: index === 0 ? "mic" : "system",
							segment,
							bytes: new Uint8Array(await event.data.arrayBuffer()),
						});
					})
					.catch(() => {
						session.failed = true;
						bridge.sourceLost(id);
					})
					.finally(() => {
						session.queuedBytes -= event.data.size;
					});
			};
			recorder.start(10000);
			return recorder;
		});
	};
	const endRecorders = async (session: Session): Promise<void> => {
		await Promise.all(
			session.recorders.map(
				(recorder) =>
					new Promise<void>((resolve, reject) => {
						if (recorder.state === "inactive") {
							resolve();
							return;
						}
						const timer = setTimeout(() => {
							session.failed = true;
							reject(new Error("Recorder did not stop"));
						}, 2000);
						recorder.onstop = () => {
							clearTimeout(timer);
							resolve();
						};
						recorder.stop();
					}),
			),
		);
		await session.pending;
	};
	const systemStream = async (
		platform: CaptureRequest["platform"],
	): Promise<MediaStream> => {
		let stream: MediaStream | undefined;
		try {
			if (platform === "darwin" || platform === "linux") {
				const devices = await media.enumerateDevices?.();
				const input = devices?.find(
					(d) => d.kind === "audioinput" && /BlackHole|Monitor/i.test(d.label),
				);
				if (!input) throw new SystemAudioUnavailable();
				stream = await media.getUserMedia({
					audio: {
						deviceId: { exact: input.deviceId },
						echoCancellation: false,
						noiseSuppression: false,
						autoGainControl: false,
					},
					video: false,
				});
			} else stream = await media.getDisplayMedia({ audio: true, video: true });
			if (!stream.getAudioTracks().length) throw new SystemAudioUnavailable();
			for (const track of stream.getVideoTracks()) {
				track.stop();
				stream.removeTrack(track);
			}
			return stream;
		} catch {
			if (stream) release([stream]);
			throw new SystemAudioUnavailable();
		}
	};
	const stopTranslation = async (): Promise<void> => {
		translationGeneration++;
		await translationContext?.close().catch(() => {});
		translationContext = undefined;
		await pcmQueue;
		if (translationOwnsStream && translationStream)
			release([translationStream]);
		translationStream = undefined;
		translationOwnsStream = false;
	};
	const perform = async (request: CaptureRequest): Promise<void> => {
		if (disposed) return;
		const { operation, id } = request;
		if (operation === "start") {
			if (sessions.has(id)) return;
			cancelled.delete(id);
			const parent = request.parentId
				? sessions.get(request.parentId)
				: undefined;
			let streams: readonly MediaStream[] = [];
			try {
				if (request.parentId && !parent) throw new Error("No main capture");
				if (parent) streams = parent.streams;
				else {
					const devices = request.microphone
						? await media.enumerateDevices?.()
						: undefined;
					const selected = request.microphone
						? recoverMicrophone(
								request.microphone,
								devices?.filter((d) => d.kind === "audioinput") ?? [],
							)
						: undefined;
					const microphoneId =
						selected?.deviceId ??
						request.microphone?.deviceId ??
						request.microphoneId;
					const mic = await media.getUserMedia({
						audio:
							microphoneId === "default"
								? true
								: { deviceId: { exact: microphoneId } },
						video: false,
					});
					streams = [mic];
					if (request.systemAudio) {
						system = await systemStream(request.platform);
						streams = [mic, system];
					}
				}
				if (disposed || cancelled.has(id)) {
					throw new Error("Capture cancelled before readiness");
				}
				const session: Session = {
					streams,
					ownsStreams: !parent,
					recorders: [],
					segment: 0,
					pending: Promise.resolve(),
					rotation: Promise.resolve(),
					queuedBytes: 0,
					failed: false,
					timer: setInterval(() => {
						session.rotation = session.rotation
							.then(async () => {
								await endRecorders(session);
								session.segment++;
								beginRecorders(id, session);
							})
							.catch(() => {
								session.failed = true;
								bridge.sourceLost(id);
							});
					}, 3600000),
				};
				sessions.set(id, session);
				beginRecorders(id, session);
				if (!parent)
					for (const stream of streams)
						for (const track of stream.getAudioTracks())
							track.onended = () => bridge.sourceLost(id);
			} catch (cause) {
				const failed = sessions.get(id);
				if (failed) {
					clearInterval(failed.timer);
					for (const recorder of failed.recorders)
						if (recorder.state !== "inactive") recorder.stop();
					sessions.delete(id);
				}
				if (!parent) release(streams);
				if (!parent) system = undefined;
				throw cause;
			}
		} else if (operation === "stop" || operation === "cancel") {
			cancelled.add(id);
			const session = sessions.get(id);
			if (!session) return;
			clearInterval(session.timer);
			try {
				await session.rotation;
				await endRecorders(session);
				if (session.failed && operation === "stop")
					throw new Error("Audio write failed");
			} finally {
				sessions.delete(id);
				if (session.ownsStreams) {
					await stopTranslation();
					release(session.streams);
					system = undefined;
				}
			}
		} else if (operation === "translate") {
			if (translationContext) return;
			const generation = ++translationGeneration;
			const stream = system ?? (await systemStream(request.platform));
			const ownsStream = stream !== system;
			if (disposed || generation !== translationGeneration) {
				if (ownsStream) release([stream]);
				throw new Error("Translation cancelled before readiness");
			}
			translationStream = stream;
			translationOwnsStream = ownsStream;
			if (ownsStream)
				for (const track of stream.getAudioTracks())
					track.onended = () =>
						bridge.sourceLost("00000000-0000-4000-8000-000000000000");
			const context = new AudioContext({ sampleRate: 24000 });
			translationContext = context;
			const source = context.createMediaStreamSource(
				new MediaStream(stream.getAudioTracks()),
			);
			const worklet = new URL("./pcm-worklet.js", import.meta.url);
			await context.audioWorklet.addModule(worklet.href);
			const node = new AudioWorkletNode(context, "meeting-pcm");
			let pending = 0;
			node.port.onmessage = (event: MessageEvent<unknown>) => {
				if (!(event.data instanceof ArrayBuffer) || pending >= 8) return;
				const bytes = new Uint8Array(event.data);
				pending++;
				pcmQueue = pcmQueue
					.then(() => bridge.pcm(bytes))
					.catch(() => {
						bridge.sourceLost("00000000-0000-4000-8000-000000000000");
					})
					.finally(() => {
						pending--;
					});
			};
			source.connect(node);
			node.connect(context.destination);
			await context.resume();
		} else await stopTranslation();
	};
	return {
		handle: async (request: CaptureRequest): Promise<void> => {
			try {
				await perform(request);
				bridge.captureReply({ requestId: request.requestId, success: true });
			} catch (cause) {
				if (request.operation === "translate") await stopTranslation();
				bridge.captureReply({
					requestId: request.requestId,
					success: false,
					...(cause instanceof SystemAudioUnavailable
						? { reason: "systemUnavailable" as const }
						: {}),
				});
			}
		},
		dispose: (): void => {
			disposed = true;
			for (const session of sessions.values()) {
				clearInterval(session.timer);
				for (const recorder of session.recorders)
					if (recorder.state !== "inactive") recorder.stop();
				if (session.ownsStreams) release(session.streams);
			}
			sessions.clear();
			void stopTranslation();
		},
	};
}
