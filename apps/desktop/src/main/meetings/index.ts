import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	Cause,
	Effect,
	Either,
	Exit,
	Fiber,
	Layer,
	Option,
	Runtime,
	Schema,
	Scope,
	Stream,
} from "effect";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { HardwareSession } from "../../../../../packages/device/src/hardware/hardware-service";
import {
	AiMeetingAdapter,
	type MeetingAdapter,
} from "../../../../../packages/edge/src/ai/meeting-adapter";
import {
	type MeetingCommand,
	MeetingId,
	type MeetingRecord,
	MeetingReply,
} from "../../../../../packages/edge/src/meetings/meeting-contracts";
import {
	type MeetingError,
	meetingError,
} from "../../../../../packages/edge/src/meetings/meeting-errors";
import { exportArtifact } from "../../../../../packages/edge/src/meetings/meeting-invariants";
import {
	MeetingCapture,
	MeetingProgress,
} from "../../../../../packages/edge/src/meetings/meeting-ports";
import { MeetingProvider } from "../../../../../packages/edge/src/meetings/meeting-provider";
import { MeetingRepository } from "../../../../../packages/edge/src/meetings/meeting-repository";
import {
	defaultMeetingConfig,
	MeetingService,
} from "../../../../../packages/edge/src/meetings/meeting-service";
import {
	AUDIO_SETUP_CHANNEL,
	AudioSetupRequest,
	audioSetupText,
} from "../../shared/audio-setup";
import {
	CAPTURE_CHUNK,
	CAPTURE_LOST,
	CAPTURE_PCM,
	CaptureChunk,
	decodeMeetingCommand,
	MEETING_REQUEST,
	MEETING_SNAPSHOT,
} from "../../shared/meeting-bridge";
import type { VoiceSurfaceEvent } from "../../shared/voice-surface";
import { agentRequestAllowed } from "../agents/controller";
import type { DesktopDiagnostics } from "../diagnostics";
import { prepareDesktopModule } from "../diagnostics/module";
import { meetingHardwareFeedback } from "../hardware/meeting-feedback";
import { isAppRenderer } from "../profiles/profile-ipc";
import { audioSetup, openBlackHoleInstaller } from "./audio-setup";
import { createCapturePort } from "./capture-port";
import { writePrivateFile } from "./private-files";
import { liveMeetingProviders, type MeetingProviderOptions } from "./provider";
import { meetingStorage } from "./storage";

/** Explicit mock only. No live request or real capture is made in mock mode. */
export const mockMeetingAdapter: MeetingAdapter = {
	submit: () => Effect.succeed("mock-task"),
	poll: () =>
		Effect.succeed({
			status: "complete",
			segments: [
				{
					id: "one",
					speaker: "1",
					startMs: 0,
					endMs: 8000,
					text: "We agreed to ship the preview on Friday. Alex owns the release checklist.",
				},
				{
					id: "two",
					speaker: "2",
					startMs: 8000,
					endMs: 16000,
					text: "I will check the accessibility issues before Thursday. The hardware review is still pending.",
				},
			],
		}),
	cancel: () => Effect.void,
	translate: () =>
		Effect.succeed([
			{
				id: crypto.randomUUID(),
				speaker: "1",
				text: "Mock live translation. The preview is scheduled for Friday.",
				final: true,
				at: Date.now(),
			},
		]),
	stopTranslation: () => Effect.void,
};
export function prepareMeetings(
	options: {
		diagnostics?: DesktopDiagnostics;
		microphone?: () => Effect.Effect<
			import("../../shared/speech").MicrophoneIdentity | undefined
		>;
		locale?: () => string;
		userData: string;
		hardware: (serial?: string) => HardwareSession | undefined;
		mock: boolean;
		renderer?: string;
		management?: () =>
			| { readonly webContents: { readonly id: number } }
			| undefined;
		ffmpeg?: string;
		adapter?: MeetingAdapter;
		provider?: MeetingProviderOptions;
		serial?: () => string;
		publishVoice?: (event: VoiceSurfaceEvent) => Promise<void>;
	},
	quitOwner = false,
) {
	const root = join(options.userData, "meetings-v1");
	const managementWindow = (): BrowserWindow | undefined => {
		const id = options.management?.()?.webContents.id;
		return BrowserWindow.getAllWindows().find(
			(win) =>
				!win.isDestroyed() &&
				win.isVisible() &&
				!win.isMinimized() &&
				win.webContents.id === id,
		);
	};
	const renderer =
		options.renderer ??
		process.env.ELECTRON_RENDERER_URL ??
		pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href;
	const encode = Schema.encodeSync(MeetingReply);
	const snapshot = MeetingService.snapshot().pipe(
		Effect.map((value) => encode({ _tag: "ready", snapshot: value })),
	);
	const failure = (error: MeetingError) =>
		encode({ _tag: "failure", code: error.code, message: error.message });
	const publishFailure = (error: MeetingError): void => {
		for (const win of BrowserWindow.getAllWindows())
			if (!win.isDestroyed())
				win.webContents.send(MEETING_SNAPSHOT, failure(error));
	};
	let capture: ReturnType<typeof createCapturePort> | undefined;
	let captureExecution: Runtime.Runtime<MeetingService> | undefined;
	let captureScope: Scope.CloseableScope | undefined;
	let removeCapture = () => {};
	const captureEffect = <A, E>(
		effect: Effect.Effect<A, E, MeetingService>,
	): Effect.Effect<A, E | MeetingError, MeetingService> =>
		captureScope
			? Effect.flatMap(Effect.forkIn(effect, captureScope), Fiber.join)
			: Effect.fail(meetingError("Unavailable"));
	const runCapture = <A, E>(effect: Effect.Effect<A, E, MeetingService>) => {
		if (!captureExecution) return Promise.reject(meetingError("Unavailable"));
		return Runtime.runPromise(captureExecution)(captureEffect(effect));
	};
	const forkCapture = (
		effect: Effect.Effect<unknown, MeetingError, MeetingService>,
	): void => {
		if (captureExecution)
			Runtime.runFork(captureExecution)(captureEffect(effect));
	};
	const captureLayer = Layer.scoped(
		MeetingCapture,
		Effect.acquireRelease(
			Effect.gen(function* () {
				captureScope = yield* Scope.make();
				const acquired = createCapturePort({
					root,
					renderer,
					hardware: options.hardware,
					managementId: () => options.management?.()?.webContents.id,
					microphone: options.microphone,
					mock: options.mock,
					ffmpeg: options.ffmpeg ?? process.env.OPEN_QUAKE_FFMPEG ?? "ffmpeg",
					onNoWindows: () => {
						forkCapture(MeetingService.suspend());
					},
					onLost: (id) => {
						if (id === "00000000-0000-4000-8000-000000000000") {
							forkCapture(MeetingService.translationLost());
							return;
						}
						if (Schema.is(MeetingId)(id))
							forkCapture(
								MeetingService.sourceLost(id).pipe(
									Effect.tapError((error) =>
										Effect.sync(() => publishFailure(error)),
									),
								),
							);
					},
				});
				let closed = false;
				capture = {
					...acquired,
					dispose: () => {
						if (closed) return;
						closed = true;
						acquired.dispose();
					},
				};
				return capture;
			}),
			(acquired) =>
				Effect.gen(function* () {
					if (captureExecution)
						yield* captureEffect(MeetingService.suspend()).pipe(
							Effect.provide(captureExecution),
							Effect.catchAllCause((cause) =>
								Effect.logWarning(
									"Meeting capture cleanup failed",
									meetingError("CaptureFailed", cause),
								),
							),
						);
					removeCapture();
					if (captureScope) yield* Scope.close(captureScope, Exit.void);
					captureScope = undefined;
					captureExecution = undefined;
					acquired.dispose();
				}),
		).pipe(Effect.map((acquired) => acquired.port)),
	);
	const supplied =
		options.adapter ?? (options.mock ? mockMeetingAdapter : undefined);
	const live =
		!supplied && options.provider
			? liveMeetingProviders(
					root,
					options.ffmpeg ?? process.env.OPEN_QUAKE_FFMPEG ?? "ffmpeg",
					options.provider,
				)
			: undefined;
	const providers = supplied
		? MeetingProvider.Default.pipe(
				Layer.provide(Layer.succeed(AiMeetingAdapter, supplied)),
			)
		: (live?.layer ?? MeetingProvider.Default);

	const feedback = meetingHardwareFeedback(options.hardware);
	let enqueueFeedback: (work: Effect.Effect<void>) => Effect.Effect<void> =
		() => Effect.void;
	const prepared = prepareDesktopModule(
		MeetingService.DefaultWithoutDependencies.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					MeetingRepository.Default(meetingStorage(root)),
					providers,
					captureLayer,
					Layer.scoped(
						MeetingProgress,
						Effect.gen(function* () {
							const toneScope = yield* Effect.scope;
							enqueueFeedback = (work) =>
								Effect.forkIn(work, toneScope).pipe(Effect.asVoid);
							return {
								publish: (event) =>
									Effect.promise(async () => {
										await options.publishVoice?.({
											_tag: "MeetingStage",
											serial:
												event.origin?.serial ??
												options.serial?.() ??
												"desktop-preview",
											keyCode: event.origin?.keyCode ?? "0,0",
											meetingId: event.meetingId,
											stage: event.stage,
											status: event.status,
										});
									}).pipe(
										Effect.zipRight(enqueueFeedback(feedback.stage(event))),
									),
							};
						}),
					),
				),
			),
			Layer.tap((context) =>
				Effect.runtime<MeetingService>().pipe(
					Effect.provide(context),
					Effect.tap((execution) =>
						Effect.sync(() => {
							captureExecution = execution;
						}),
					),
				),
			),
		),
		(runtime) => {
			const jobs = new Map<MeetingId, Fiber.RuntimeFiber<void, MeetingError>>();
			const startJob = (
				id: MeetingId,
				template?: MeetingRecord["template"],
			): void => {
				if (disposed || jobs.has(id)) return;
				const fiber = runtime.runFork(
					(template
						? MeetingService.regenerate(id, template)
						: MeetingService.process(id)
					).pipe(
						Effect.tapError((error) =>
							Effect.sync(() => publishFailure(error)),
						),
					),
				);
				jobs.set(id, fiber);
				fiber.addObserver(() => {
					if (jobs.get(id) === fiber) jobs.delete(id);
				});
			};
			const interrupt = async (id: MeetingId): Promise<void> => {
				const state = await runtime.runPromise(MeetingService.snapshot());
				for (const record of state.records.filter(
					(r) => r.id === id || Option.contains(r.parentId, id),
				)) {
					const job = jobs.get(record.id);
					if (job) await runtime.runPromise(Fiber.interrupt(job));
				}
			};
			const ready = runtime.runPromiseExit(
				Effect.gen(function* () {
					const saved = live ? yield* live.initialConfig : undefined;
					yield* MeetingService.configure(
						options.mock
							? defaultMeetingConfig
							: (saved ?? {
									...defaultMeetingConfig,
									asrProvider: "dashscope",
									minutesModel: "qwen3.6-flash",
								}),
						options.mock,
					);
				}),
			);
			const published = runtime.runFork(
				MeetingService.subscribe().pipe(
					Effect.flatMap((stream) =>
						Stream.runForEach(stream, (value) =>
							Effect.sync(() => {
								const wire = encode({ _tag: "ready", snapshot: value });
								for (const win of BrowserWindow.getAllWindows())
									if (!win.isDestroyed())
										win.webContents.send(MEETING_SNAPSHOT, wire);
							}),
						),
					),
				),
			);
			const runCommand = (
				command: MeetingCommand,
			): Effect.Effect<unknown, MeetingError, MeetingService> =>
				Effect.gen(function* () {
					switch (command._tag) {
						case "read":
							break;
						case "configure":
							if (
								!options.mock &&
								(command.config.asrProvider === "mock" ||
									command.config.minutesModel === "deterministic-text-v1")
							)
								return yield* meetingError("Unavailable");
							yield* MeetingService.configure(command.config, options.mock);
							break;
						case "action": {
							const before = yield* MeetingService.snapshot();
							const next = yield* MeetingService.action(command.action, {
								serial: options.serial?.() ?? "desktop-preview",
								keyCode: command.keyCode ?? "0,0",
							});
							if (command.action === "meetingRecordMark")
								yield* enqueueFeedback(
									feedback.mark(
										before,
										next,
										options.serial?.() ?? "desktop-preview",
									),
								);
							for (const record of next.records)
								if (
									record.state === "recorded" &&
									record.config.autoGenerate &&
									before.records.find((r) => r.id === record.id)?.state ===
										"recording"
								)
									startJob(record.id);
							break;
						}
						case "cancel":
							yield* Effect.promise(() => interrupt(command.id));
							yield* MeetingService.cancel(command.id);
							break;
						case "delete":
							yield* Effect.promise(() => interrupt(command.id));
							yield* MeetingService.delete(command.id);
							break;
						case "retry":
							startJob(command.id);
							break;
						case "regenerate":
							startJob(command.id, command.template);
							break;
						case "rename":
							yield* MeetingService.rename(command.id, command.title);
							break;
						case "template":
							yield* MeetingService.template(command.id, command.template);
							break;
						case "tab":
							yield* MeetingService.tab(command.tab);
							break;
						case "clear":
							yield* MeetingService.clear();
							break;
						case "remoteFiles": {
							const ids = yield* MeetingService.files(
								command.id,
								command.operation,
								command.fileId,
							);
							return encode({ _tag: "remoteFiles", ids });
						}
						case "reveal":
						case "export": {
							const record = (yield* MeetingService.snapshot()).records.find(
								(r) => r.id === command.id,
							);
							if (!record) return yield* meetingError("Invalid");
							if (command._tag === "reveal") {
								yield* Effect.tryPromise({
									try: async () => {
										const directory = join(root, record.id);
										const audio = join(directory, "final_recording.mp3");
										if (
											!(await lstat(root)).isDirectory() ||
											!(await lstat(directory)).isDirectory() ||
											!(await lstat(audio)).isFile()
										)
											throw new Error("Invalid managed audio");
										shell.showItemInFolder(audio);
									},
									catch: (cause) => meetingError("AudioMissing", cause),
								});
								break;
							}
							const artifact = exportArtifact(record, command.artifact);
							if (!artifact.text) return yield* meetingError("Invalid");
							yield* Effect.tryPromise({
								try: async () => {
									const owner = managementWindow();
									if (!owner) throw meetingError("ExportFailed");
									const result = await dialog.showSaveDialog(owner, {
										defaultPath: artifact.name,
										filters: [
											{
												name:
													command.artifact === "summary"
														? "Markdown"
														: "Plain text",
												extensions: [
													command.artifact === "summary" ? "md" : "txt",
												],
											},
										],
									});
									if (!result.canceled && result.filePath)
										await writePrivateFile(result.filePath, artifact.text);
								},
								catch: (cause) => meetingError("ExportFailed", cause),
							});
							break;
						}
					}
					return yield* snapshot;
				});
			const setup = audioSetup({
				active: () => !disposed,
				platform: process.platform,
				mock: options.mock,
				confirm: async () => {
					const owner = managementWindow();
					if (!owner) return false;
					const text = audioSetupText(options.locale?.() ?? "en");
					return (
						(
							await dialog.showMessageBox(owner, {
								type: "warning",
								message: text.nativeConfirm,
								detail: `${text.warning}\n\n${text.retention}`,
								buttons: [text.cancel, text.nativeChoose],
								defaultId: 0,
								cancelId: 0,
							})
						).response === 1
					);
				},
				select: async () => {
					const owner = managementWindow();
					if (!owner) return undefined;
					const text = audioSetupText(options.locale?.() ?? "en");
					const result = await dialog.showOpenDialog(owner, {
						title: text.nativeTitle,
						buttonLabel: text.nativeChoose,
						properties: ["openFile"],
						filters: [{ name: text.nativeFilter, extensions: ["pkg"] }],
					});
					return result.canceled ? undefined : result.filePaths[0];
				},
				openInstaller: (selected) =>
					openBlackHoleInstaller({
						selected,
						root: join(root, "installer-handoffs"),
						open: (path) => shell.openPath(path),
					}),
			});
			ipcMain.handle(AUDIO_SETUP_CHANNEL, async (event, value: unknown) => {
				if (
					!agentRequestAllowed(
						{
							senderId: event.sender.id,
							frameURL: event.senderFrame?.url ?? "",
							mainFrame: event.senderFrame === event.sender.mainFrame,
						},
						options.management?.()?.webContents.id,
						renderer,
					) ||
					!Schema.is(AudioSetupRequest)(value)
				)
					return { platform: process.platform, state: "failed" };
				if (disposed) return { platform: process.platform, state: "failed" };
				return value.action === "status"
					? setup.status()
					: Effect.runPromise(setup.install());
			});
			ipcMain.handle(
				MEETING_REQUEST,
				async (event, value: unknown): Promise<unknown> => {
					if (
						event.senderFrame !== event.sender.mainFrame ||
						!BrowserWindow.fromWebContents(event.sender) ||
						!isAppRenderer(event.sender.getURL(), renderer)
					)
						return failure(meetingError("Invalid"));
					const decoded = decodeMeetingCommand(value);
					if (Either.isLeft(decoded)) return failure(meetingError("Invalid"));
					if (
						decoded.right._tag === "remoteFiles" &&
						!agentRequestAllowed(
							{
								senderId: event.sender.id,
								frameURL: event.senderFrame?.url ?? "",
								mainFrame: event.senderFrame === event.sender.mainFrame,
							},
							options.management?.()?.webContents.id,
							renderer,
						)
					)
						return failure(meetingError("Invalid"));
					const initialized = await ready;
					if (initialized._tag === "Failure") {
						const error = Cause.failureOption(initialized.cause);
						return failure(
							Option.getOrElse(error, () => meetingError("Unavailable")),
						);
					}
					if (!capture || disposed) return failure(meetingError("Unavailable"));
					if (capture.accepts(event)) return failure(meetingError("Invalid"));
					const result = await runtime.runPromiseExit(
						runCommand(decoded.right),
					);
					if (result._tag === "Success") return result.value;
					const error = Cause.failureOption(result.cause);
					return failure(
						Option.getOrElse(error, () => meetingError("Unavailable")),
					);
				},
			);
			ipcMain.handle(CAPTURE_CHUNK, async (event, value: unknown) => {
				await ready;
				const chunk = Schema.decodeUnknownEither(CaptureChunk)(value);
				if (
					!capture?.accepts(event) ||
					Either.isLeft(chunk) ||
					!capture.active(chunk.right.id)
				)
					throw new Error("Meeting audio chunk rejected");
				await runCapture(capture.files.write(chunk.right));
			});
			ipcMain.handle(CAPTURE_PCM, async (event, value: unknown) => {
				await ready;
				if (
					!capture?.accepts(event) ||
					!(value instanceof Uint8Array) ||
					value.length > 14400
				)
					throw new Error("Meeting PCM rejected");
				await runCapture(
					MeetingService.translate(value).pipe(
						Effect.tapError(() =>
							Effect.sync(() => {
								forkCapture(MeetingService.translationLost());
							}),
						),
					),
				);
			});
			const lost = (event: Electron.IpcMainEvent, value: unknown): void => {
				if (!capture?.accepts(event) || !Schema.is(MeetingId)(value)) return;
				forkCapture(
					(value === "00000000-0000-4000-8000-000000000000"
						? MeetingService.translationLost()
						: MeetingService.sourceLost(value)
					).pipe(
						Effect.tapError((error) =>
							Effect.sync(() => publishFailure(error)),
						),
					),
				);
			};
			ipcMain.on(CAPTURE_LOST, lost);
			removeCapture = () => {
				ipcMain.removeHandler(CAPTURE_CHUNK);
				ipcMain.removeHandler(CAPTURE_PCM);
				ipcMain.removeListener(CAPTURE_LOST, lost);
			};
			let disposed = false;
			let disposal: Promise<void> | undefined;
			const dispose = (): Promise<void> => {
				if (disposal) return disposal;
				disposed = true;
				disposal = (async () => {
					ipcMain.removeHandler(MEETING_REQUEST);
					ipcMain.removeHandler(AUDIO_SETUP_CHANNEL);
					for (const fiber of jobs.values())
						await runtime.runPromise(Fiber.interrupt(fiber));
					await runtime.runPromiseExit(MeetingService.suspend());
					await runtime.runPromiseExit(Fiber.interrupt(published));
					try {
						await runtime.dispose();
					} finally {
						// Failed acquisition has no graph-owned capture finalizer.
						if (!capture) {
							removeCapture();
							if (captureScope)
								await Effect.runPromise(Scope.close(captureScope, Exit.void));
						}
					}
					app.removeListener("before-quit", beforeQuit);
				})();
				return disposal;
			};
			let quitting = false;
			const beforeQuit = (event: Electron.Event): void => {
				event.preventDefault();
				if (!quitting) {
					quitting = true;
					void dispose().then(() => app.quit());
				}
			};
			if (quitOwner) app.on("before-quit", beforeQuit);
			return { runtime, dispose, ready };
		},
		options.diagnostics,
		"app.background",
	);
	return prepared;
}

export function registerMeetings(...args: Parameters<typeof prepareMeetings>) {
	return prepareMeetings(args[0], true).standalone();
}
