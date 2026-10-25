import { Effect } from "effect";
import { type BrowserWindow, ipcMain } from "electron";
import {
	SPEECH_SETTINGS_CHANNEL,
	type SpeechSettingsReply,
} from "../../shared/speech";
import { agentRequestAllowed } from "../agents/controller";
import type { SpeechSettingsController } from "./settings";

export function registerSpeechSettings(options: {
	readonly controller: SpeechSettingsController;
	readonly management: () => BrowserWindow | undefined;
	readonly renderer: string;
	readonly instrument?: <A, E, R>(
		effect: Effect.Effect<A, E, R>,
		operation: "voice.request",
	) => Effect.Effect<A, E, R>;
	readonly run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}): () => void {
	ipcMain.handle(
		SPEECH_SETTINGS_CHANNEL,
		(event, input: unknown): Promise<SpeechSettingsReply> => {
			if (
				!agentRequestAllowed(
					{
						senderId: event.sender.id,
						frameURL: event.senderFrame?.url ?? "",
						mainFrame: event.senderFrame === event.sender.mainFrame,
					},
					options.management()?.webContents.id,
					options.renderer,
				)
			)
				return Promise.resolve({
					_tag: "rejected",
					code: "VOICE.SETTINGS.UNAUTHORIZED",
				});
			const request = options.controller.request(input);
			return options.run(
				(options.instrument
					? options.instrument(request, "voice.request")
					: request
				).pipe(
					Effect.match({
						onSuccess: (view) => ({ _tag: "success", view }) as const,
						onFailure: (error) =>
							({ _tag: "rejected", code: error.code }) as const,
					}),
				),
			);
		},
	);
	return () => ipcMain.removeHandler(SPEECH_SETTINGS_CHANNEL);
}
