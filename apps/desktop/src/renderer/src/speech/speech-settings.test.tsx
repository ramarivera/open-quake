// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import type { SpeechSettingsView } from "../../../shared/speech";
import { button, click, input, mount, query } from "../../test/dom";
import { SpeechSettingsPanel } from "./SpeechSettings";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const dispose of disposers.splice(0)) await dispose();
	vi.unstubAllGlobals();
});
async function fixture(
	view: SpeechSettingsView = {
		settings: { version: 1, speakAnswers: false },
		sttCredential: false,
		ttsCredential: false,
	},
) {
	const request = vi.fn(async (_request: unknown) => ({
		_tag: "success",
		view,
	}));
	vi.stubGlobal("quakeSpeech", { request });
	vi.stubGlobal("navigator", {
		mediaDevices: {
			enumerateDevices: async () => [],
			addEventListener: () => {},
			removeEventListener: () => {},
		},
	});
	const { host, close } = await mount(<SpeechSettingsPanel />);
	disposers.push(close);
	return {
		host,
		request,
		save: button(host, "Save speech settings"),
		select: (label: string, value: string) =>
			input(
				query(host, `select[aria-label="${label}"]`, HTMLSelectElement),
				value,
			),
		enter: (label: string, value: string) =>
			input(
				query(host, `input[aria-label="${label}"]`, HTMLInputElement),
				value,
			),
	};
}
it("blocks incomplete recognition settings before IPC and saves a complete provider draft", async () => {
	const f = await fixture();
	await f.select("Recognition provider", "dashscope");
	expect(f.save.disabled).toBe(true);
	expect(f.host.textContent).toContain(
		"Complete the recognition provider settings",
	);
	await click(f.save);
	expect(f.request).toHaveBeenCalledTimes(1);
	await f.enter("ASR workspace", "fixture-workspace");
	expect(f.save.disabled).toBe(true);
	await f.enter("ASR API key", "fixture-key");
	expect(f.save.disabled).toBe(false);
	await click(f.save);
	expect(f.request).toHaveBeenLastCalledWith({
		_tag: "Save",
		settings: {
			version: 1,
			speakAnswers: false,
			stt: {
				provider: "dashscope",
				workspace: "fixture-workspace",
				region: "ap-southeast-1",
			},
		},
		sttKey: "fixture-key",
	});
});
it("requires replacement credentials only when the saved provider scope changes", async () => {
	const f = await fixture({
		settings: {
			version: 1,
			speakAnswers: false,
			stt: {
				provider: "dashscope",
				workspace: "saved",
				region: "ap-southeast-1",
			},
		},
		sttCredential: true,
		ttsCredential: false,
	});
	expect(f.save.disabled).toBe(false);
	await f.enter("ASR workspace", "changed");
	expect(f.save.disabled).toBe(true);
	expect(f.host.textContent).not.toContain("Credentials stored.");
	await f.enter("ASR workspace", "saved");
	expect(f.save.disabled).toBe(false);
	await f.select("ASR region", "cn-beijing");
	expect(f.save.disabled).toBe(true);
	await f.select("Recognition provider", "openai");
	expect(f.save.disabled).toBe(true);
	await f.enter("ASR API key", "replacement");
	expect(f.save.disabled).toBe(false);
});
it("requires complete XFY bundles and drops obsolete credentials when disabling a route", async () => {
	const f = await fixture();
	await f.select("Synthesis provider", "xfy");
	await f.enter("TTS XFY appId", "app");
	expect(f.save.disabled).toBe(true);
	await f.enter("TTS XFY apiKey", "key");
	expect(f.save.disabled).toBe(true);
	await f.enter("TTS XFY apiSecret", "secret");
	expect(f.save.disabled).toBe(false);
	await f.enter("TTS XFY apiSecret", "");
	expect(f.save.disabled).toBe(true);
	await f.select("Synthesis provider", "disabled");
	expect(f.save.disabled).toBe(false);
	await click(f.save);
	expect(f.request).toHaveBeenLastCalledWith({
		_tag: "Save",
		settings: { version: 1, speakAnswers: false, tts: undefined },
	});
});

it("keeps stored Azure credentials for language-only edits and the implicit default region", async () => {
	const f = await fixture({
		settings: {
			version: 1,
			speakAnswers: false,
			stt: { provider: "azure", language: "en-US" },
		},
		sttCredential: true,
		ttsCredential: false,
	});
	await f.select("Recognition language", "zh-CN");
	expect(f.save.disabled).toBe(false);
	await f.enter("ASR Azure region", "eastasia");
	expect(f.save.disabled).toBe(false);
	await f.enter("ASR Azure region", "westus");
	expect(f.save.disabled).toBe(true);
});
