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
			return options.run(
				options.controller.request(input).pipe(
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
