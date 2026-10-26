import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPEECH_SETTINGS_CHANNEL } from "../../shared/speech";
import { registerSpeechSettings } from "./settings-ipc";

const electron = vi.hoisted(() => ({
	ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
}));
vi.mock("electron", () => electron);
afterEach(() => vi.clearAllMocks());
describe("production speech settings IPC authorization", () => {
	it("permits only the management main frame and passes no untrusted credential reference to the consumer", async () => {
		const request = vi.fn(() =>
			Effect.succeed({
				settings: { version: 1 as const, speakAnswers: false },
				sttCredential: false,
				ttsCredential: false,
			}),
		);
		const dispose = registerSpeechSettings({
			controller: {
				hostTones: () => Effect.succeed(false),
				microphone: () => Effect.succeed(undefined),
				profiles: () => Effect.succeed({ speakAnswers: false }),
				request,
			},
			management: () =>
				({ webContents: { id: 7 } }) as import("electron").BrowserWindow,
			renderer: "file:///app/index.html",
			run: (effect) => Effect.runPromise(effect),
		});
		const handler = electron.ipcMain.handle.mock.calls.find(
			([channel]) => channel === SPEECH_SETTINGS_CHANNEL,
		)?.[1] as
			| ((event: unknown, input: unknown) => Promise<unknown>)
			| undefined;
		if (!handler) throw new Error("missing settings handler");
		const frame = { url: "file:///app/index.html?surface=management" };
		expect(
			await handler(
				{ sender: { id: 8, mainFrame: frame }, senderFrame: frame },
				{ _tag: "Get" },
			),
		).toMatchObject({ _tag: "rejected", code: "VOICE.SETTINGS.UNAUTHORIZED" });
		expect(
			await handler(
				{ sender: { id: 7, mainFrame: {} }, senderFrame: frame },
				{ _tag: "Get" },
			),
		).toMatchObject({ _tag: "rejected" });
		expect(
			await handler(
				{
					sender: { id: 7, mainFrame: frame },
					senderFrame: { ...frame, url: "https://example.test" },
				},
				{ _tag: "Get" },
			),
		).toMatchObject({ _tag: "rejected" });
		expect(request).not.toHaveBeenCalled();
		expect(
			await handler(
				{ sender: { id: 7, mainFrame: frame }, senderFrame: frame },
				{ _tag: "Get" },
			),
		).toMatchObject({ _tag: "success" });
		expect(request).toHaveBeenCalledExactlyOnceWith({ _tag: "Get" });
		dispose();
		expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith(
			SPEECH_SETTINGS_CHANNEL,
		);
	});
});
