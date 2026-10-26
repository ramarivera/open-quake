import type { HardwareSession } from "@open-quake/device";
import { Effect, Schema } from "effect";
import { ipcMain } from "electron";
import { STRIP_MESSAGE, StripMessage } from "../shared/strip-transport";

export interface StripMessageOwners {
	readonly press: (
		serial: string,
		keyCode: string,
		action: 0 | 1 | 2 | 3,
	) => Promise<void>;
	readonly active: (
		serial: string,
		resourceId: string,
		version: number,
	) => Promise<void>;
	readonly gaming: (serial: string, enabled: boolean) => Promise<void>;
	readonly chat: (
		serial: string,
		message: Extract<StripMessage, { type: "clawBotChatRequest" }>,
	) => Promise<void>;
	readonly management: (tab: string | undefined) => Promise<void>;
}
export async function dispatchStripMessage(
	owners: StripMessageOwners,
	serial: string,
	input: unknown,
): Promise<boolean> {
	if (!Schema.is(StripMessage)(input)) return false;
	switch (input.type) {
		case "press":
			await owners.press(serial, input.keyCode, input.keyAction);
			break;
		case "reportConfig":
			// Registration records capabilities before accepting operations for this session.
			break;
		case "reportActiveProfile":
			await owners.active(serial, input.resourceId, input.version);
			break;
		case "modeSwitch":
			await owners.gaming(serial, input.enable);
			break;
		case "clawBotChatRequest":
			await owners.chat(serial, input);
			break;
		case "functionKeyPressed":
			await owners.management(input.tabType);
			break;
		// DK-Suite background.js case callback is intentionally a no-op. Timers run in main here.
		case "callback":
			break;
	}
	return true;
}
export function registerStripTransport(options: {
	readonly serial: (sender: Electron.WebContents) => string | undefined;
	readonly hardware: (serial: string) => HardwareSession | undefined;
	readonly owners: StripMessageOwners;
}) {
	const configured = new WeakMap<
		Electron.WebContents,
		{ hardware: HardwareSession; session: string }
	>();
	ipcMain.handle(
		STRIP_MESSAGE,
		async (event, session: unknown, input: unknown) => {
			const serial = options.serial(event.sender);
			if (
				!serial ||
				event.senderFrame !== event.sender.mainFrame ||
				typeof session !== "string"
			)
				return { ok: false };
			const hardware = options.hardware(serial);
			if (!hardware) return { ok: false };
			const state = await Effect.runPromise(hardware.snapshot());
			if (
				!state.available ||
				state.session !== session ||
				options.hardware(serial) !== hardware
			)
				return { ok: false };
			if (!Schema.is(StripMessage)(input)) return { ok: false };
			const config = configured.get(event.sender);
			if (
				input.type !== "reportConfig" &&
				(config?.hardware !== hardware || config.session !== session)
			)
				return { ok: false };
			try {
				const ok = await dispatchStripMessage(options.owners, serial, input);
				if (ok && input.type === "reportConfig")
					configured.set(event.sender, { hardware, session });
				return { ok };
			} catch {
				return { ok: false };
			}
		},
	);
	return () => ipcMain.removeHandler(STRIP_MESSAGE);
}
