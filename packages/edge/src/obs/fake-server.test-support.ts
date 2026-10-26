import { createHash } from "node:crypto";
import { once } from "node:events";
import { Schema } from "effect";
import { type WebSocket, WebSocketServer } from "ws";

const data = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const requestFrame = Schema.Struct({ op: Schema.Int, d: data });
export interface FakeCall {
	readonly type: string;
	readonly data: Readonly<Record<string, unknown>>;
}
export async function fakeObsServer(
	options: {
		readonly password?: string;
		readonly rpcVersion?: number;
		readonly rejectAuth?: boolean;
		readonly scenes?: readonly {
			readonly sceneUuid: string;
			readonly sceneName: string;
		}[];
		readonly transitions?: readonly { readonly transitionName: string }[];
		readonly sceneItems?: Readonly<
			Record<
				string,
				readonly { readonly sceneItemId: number; readonly sourceName: string }[]
			>
		>;
		readonly inputs?: readonly {
			readonly inputUuid: string;
			readonly inputName: string;
			readonly inputKind: string;
		}[];
		readonly silentInputs?: readonly string[];
	} = {},
) {
	const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	await once(server, "listening");
	const address = server.address();
	if (typeof address === "string" || address === null)
		throw new Error("Expected loopback port");
	const calls: FakeCall[] = [],
		clients = new Set<WebSocket>();
	const delays = new Map<string, number>();
	const waits: {
		readonly predicate: () => boolean;
		readonly resolve: () => void;
	}[] = [];
	const notify = () => {
		for (const item of [...waits])
			if (item.predicate()) {
				waits.splice(waits.indexOf(item), 1);
				item.resolve();
			}
	};
	const state = {
		volume: 0.98,
		muted: false,
		source: true,
		studio: false,
		stream: true,
		record: true,
		paused: false,
	};
	let screenshot = "data:image/jpeg;base64,/9j/2Q==";
	let connections = 0,
		authRejected = 0,
		failures = new Set<string>(),
		hold = new Set<string>();
	server.on("connection", (socket) => {
		connections++;
		clients.add(socket);
		notify();
		socket.on("close", () => clients.delete(socket));
		socket.send(
			JSON.stringify({
				op: 0,
				d: {
					rpcVersion: options.rpcVersion ?? 1,
					...(options.password === undefined
						? {}
						: {
								authentication: {
									salt: "fixture-salt",
									challenge: "fixture-challenge",
								},
							}),
				},
			}),
		);
		socket.on("message", (raw) => {
			const frame = Schema.decodeUnknownSync(Schema.parseJson(requestFrame))(
				raw.toString(),
			);
			if (frame.op === 1) {
				const secret = createHash("sha256")
					.update(`${options.password}fixture-salt`)
					.digest("base64");
				const expected = createHash("sha256")
					.update(`${secret}fixture-challenge`)
					.digest("base64");
				if (
					options.rejectAuth ||
					(options.password !== undefined &&
						frame.d.authentication !== expected)
				) {
					authRejected++;
					socket.close(4009, "do-not-leak server-password");
					notify();
					return;
				}
				socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
				return;
			}
			if (frame.op !== 6 || typeof frame.d.requestType !== "string") return;
			const type = frame.d.requestType;
			const values = Schema.decodeUnknownSync(data)(frame.d.requestData ?? {});
			calls.push({ type, data: values });
			notify();
			if (hold.has(type)) return;
			let response: Record<string, unknown> = {};
			switch (type) {
				case "GetInputVolume":
					response = { inputVolumeMul: state.volume };
					break;
				case "SetInputVolume":
					if (typeof values.inputVolumeMul === "number")
						state.volume = values.inputVolumeMul;
					break;
				case "GetInputMute":
					response = { inputMuted: state.muted };
					break;
				case "ToggleInputMute":
					state.muted = !state.muted;
					break;
				case "GetSceneItemEnabled":
					response = { sceneItemEnabled: state.source };
					break;
				case "GetStudioModeEnabled":
					response = { studioModeEnabled: state.studio };
					break;
				case "GetStreamStatus":
					response = { outputActive: state.stream };
					break;
				case "GetRecordStatus":
					response = { outputActive: state.record, outputPaused: state.paused };
					break;
				case "GetReplayBufferStatus":
				case "GetVirtualCamStatus":
					response = { outputActive: true };
					break;
				case "GetCurrentProgramScene":
				case "GetCurrentPreviewScene":
					response = { sceneUuid: "scene-1" };
					break;
				case "GetStats":
					response = {
						cpuUsage: 12.34,
						outputSkippedFrames: 2,
						renderSkippedFrames: 3,
						renderTotalFrames: 100,
					};
					break;
				case "GetSourceScreenshot":
					response = { imageData: screenshot };
					break;
				case "GetSceneList":
					response = {
						scenes: options.scenes ?? [
							{ sceneUuid: "scene-1", sceneName: "Main" },
						],
					};
					break;
				case "GetInputList":
					response = {
						inputs: options.inputs ?? [
							{
								inputUuid: "input-1",
								inputName: "Mic",
								inputKind: "audio_input_capture",
							},
						],
					};
					break;
				case "GetSpecialInputs":
					response = { mic1: "Mic", desktop1: "Desktop Audio" };
					break;
				case "GetSceneTransitionList":
					response = {
						transitions: options.transitions ?? [{ transitionName: "Fade" }],
					};
					break;
				case "GetSceneItemList":
					response = {
						sceneItems: options.sceneItems?.[String(values.sceneUuid)] ?? [
							{ sceneItemId: 7, sourceName: "Camera" },
						],
					};
					break;
			}
			const reply = JSON.stringify({
				op: 7,
				d: {
					requestType: type,
					requestId: frame.d.requestId,
					requestStatus: {
						result:
							!failures.has(type) &&
							!(
								type === "GetInputVolume" &&
								options.silentInputs?.includes(String(values.inputUuid))
							),
						code: failures.has(type) ? 600 : 100,
						comment: "do-not-leak private remote comment",
					},
					responseData: response,
				},
			});
			const delay = delays.get(type);
			if (delay)
				setTimeout(() => {
					if (socket.readyState === socket.OPEN) socket.send(reply);
				}, delay);
			else socket.send(reply);
		});
	});
	return {
		port: address.port,
		screenshot: (data: string) => {
			screenshot = data;
		},
		calls,
		delay: (type: string, milliseconds: number) =>
			delays.set(type, milliseconds),
		state,
		connections: () => connections,
		authRejected: () => authRejected,
		fail: (types: string[]) => {
			failures = new Set(types);
		},
		hold: (types: string[]) => {
			hold = new Set(types);
		},
		kick: async () => {
			await Promise.all(
				[...clients].map(async (socket) => {
					const closed = once(socket, "close");
					socket.close(4011, "do-not-leak private operator reason");
					await closed;
				}),
			);
		},
		disconnect: () => {
			for (const socket of clients) socket.terminate();
		},
		waitFor: (predicate: () => boolean) =>
			predicate()
				? Promise.resolve()
				: new Promise<void>((resolve) => waits.push({ predicate, resolve })),
		close: async () => {
			for (const socket of clients) socket.terminate();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
