import { describe, expect, it } from "vitest";
import { decodeDraft } from "./shortcut-invariants";

const config = (
	functionType: string,
	actions: readonly unknown[],
	title = functionType,
) => ({ title, icon: "mdi-keyboard", config: { functionType, actions } });
describe("AI-121 safe ConfigDetail drafts", () => {
	it("retains canonical website/text/switch/timer/media/brightness types and labels while dropping unsafe actions", () => {
		const result = decodeDraft(
			JSON.stringify({
				ConfigTitle: "Tools",
				ConfigData: [
					config(
						"hotkey",
						[{ operationName: "key", operationValue: "Ctrl + C" }],
						"Kopieren",
					),
					config("hotkeySwitch", [
						{ type: "key", value: "ctrl+c" },
						{ type: "key", value: "ctrl+v" },
					]),
					config("website", [{ type: "url", value: "https://example.org" }]),
					config("text", [
						{ type: "text", value: "Hallo" },
						{ type: "key", value: "enter" },
					]),
					config("timer", [
						{ type: "time", value: 1000 },
						{ type: "sound", value: "" },
						{ type: "callback", value: 1 },
					]),
					config("playPause", [{ type: "key", value: "audio_play" }]),
					config("panelBrightness", [{ type: "stepPercent", value: 10 }]),
					config("cmd", [{ type: "shell", value: "must not run" }]),
					config("open", [{ type: "path", value: "/private/invented.app" }]),
				],
			}),
			"Editor",
			() => "id",
		);
		expect(result.rows).toHaveLength(7);
		expect(result.dropped).toBe(2);
		expect(result.rows[0]).toMatchObject({
			name: "Kopieren",
			chord: "control+c",
			icon: "mdi-keyboard",
		});
		expect(result.rows.slice(1).map((r) => r.config?.type)).toEqual([
			"hotkeySwitch",
			"website",
			"text",
			"timer",
			"playPause",
			"panelBrightness",
		]);
	});
	it("rejects executable text outside JSON and invalid retained actions", () => {
		expect(() => decodeDraft("(()=>alert(1))()", "", () => "")).toThrow();
		expect(
			decodeDraft(
				JSON.stringify({
					ConfigTitle: "X",
					ConfigData: [
						config("website", [{ type: "url", value: "javascript:alert(1)" }]),
					],
				}),
				"",
				() => "",
			).dropped,
		).toBe(1);
	});
});
