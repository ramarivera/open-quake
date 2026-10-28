// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { defaultHardwarePreferences } from "../../../../../../packages/device/src/hardware/hardware-contracts";
import { builtinProfiles } from "../../../../../../packages/device/src/profiles/profile-catalog";
import type { ProfileKey } from "../../../../../../packages/device/src/profiles/profile-contracts";
import type {
	HardwareRequest,
	HardwareResponse,
} from "../../../shared/hardware-contracts";
import {
	APP_LANGUAGES,
	type AppLocaleBridge,
	type LocaleSnapshot,
} from "../../../shared/locale";
import { AppLocaleProvider } from "../i18n";
import { stripLayout } from "../strip/geometry";
import { previewVoiceContext } from "../strip/overlays/voice/voice-context";
import { GameModeSettings } from "./GameModeSettings";
import { GameModeTile } from "./GameModeTile";
import { HardwareSettings } from "./HardwareSettings";
import strings from "./strings.json";

const host = document.createElement("div");
document.body.append(host);
const root = createRoot(host);
afterEach(async () => {
	await act(async () => root.render(null));
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
const snapshot = {
	serial: "user-serial",
	session: "session",
	available: true,
	mic: false,
	luminance: 255,
	preferences: { ...defaultHardwarePreferences, alertVolume: 0 },
	preferenceStatus: "failed" as const,
	inputMode: "device" as const,
};
const lighting: Extract<HardwareResponse, { _tag: "lighting" }> = {
	_tag: "lighting",
	session: "session",
	status: "ready",
	saveStatus: "saved",
	canSave: true,
	fields: [
		{
			field: "brightness",
			valueId: 9,
			range: { min: 0, max: 255 },
			readable: true,
			writable: true,
			evidence: {
				identity: { firmware: "fake", protocolVersion: 10 },
				basis: "hid-fake",
			},
		},
		{
			field: "effectSpeed",
			valueId: 11,
			range: { min: 0, max: 255 },
			readable: true,
			writable: true,
			evidence: {
				identity: { firmware: "fake", protocolVersion: 10 },
				basis: "hid-fake",
			},
		},
		{
			field: "color1",
			valueId: 12,
			hue: { min: 0, max: 255 },
			saturation: { min: 0, max: 255 },
			readable: true,
			writable: true,
			evidence: {
				identity: { firmware: "fake", protocolVersion: 10 },
				basis: "hid-fake",
			},
		},
	],
	values: [
		{ field: "brightness", value: 180 },
		{ field: "effectSpeed", value: 100 },
		{ field: "color1", value: { hue: 12, saturation: 128 } },
	],
};
function localeBridge(): AppLocaleBridge {
	let snapshot: LocaleSnapshot = { locale: "en", revision: 0 };
	const listeners = new Set<(value: LocaleSnapshot) => void>();
	return {
		read: async () => snapshot,
		set: async (locale) => {
			snapshot = { locale, revision: snapshot.revision + 1 };
			for (const receive of listeners) receive(snapshot);
			return snapshot;
		},
		subscribe: (receive) => {
			listeners.add(receive);
			return () => listeners.delete(receive);
		},
		dispose: async () => {},
	};
}
function fixture(lightingProfile = lighting) {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	let failure = false;
	let saveStatus = lighting.saveStatus;
	const request = vi.fn(async (command: HardwareRequest): Promise<unknown> => {
		if (command._tag === "qmkTargets")
			return {
				_tag: "qmkTargets",
				targets: [{ serial: "user-serial", session: "session" }],
			};
		if (command._tag === "qmk") return { _tag: "qmk", values: [[0, 10]] };
		if (command._tag === "lighting") {
			if (failure) throw new Error("private raw failure");
			return { ...lightingProfile, saveStatus };
		}
		if (command._tag === "chooseGameTarget")
			return { _tag: "failure", code: "QUAKE.HARDWARE.UNAVAILABLE" };
		if (failure) return { _tag: "failure", code: "QUAKE.HARDWARE.UNAVAILABLE" };
		return { _tag: "ready", snapshot, mock: true };
	});
	vi.stubGlobal("quakeHardware", { request });
	vi.stubGlobal("quakeKeyLibrary", {
		request: async () => ({ _tag: "failure" }),
	});
	const profile = builtinProfiles("linux").find((p) => p.id === "1-0");
	if (!profile) throw new Error("Missing game preset");
	const tile = stripLayout(profile, profile.pages[0]).tiles.find(
		(t) => t.type === "gameMode",
	);
	if (!tile) throw new Error("Missing game tile");
	const initialDraft = {
		...tile.key,
		config: {
			...tile.key.config,
			actions: [{ type: "path", value: "/user/English <draft>.app" }],
		},
	};
	function Draft() {
		const [value, setValue] = useState<ProfileKey>(initialDraft);
		return <GameModeSettings value={value} onChange={setValue} />;
	}
	const bridge = localeBridge();
	const render = () =>
		root.render(
			<AppLocaleProvider bridge={bridge}>
				<HardwareSettings />
				<Draft />
				<GameModeTile
					tile={tile}
					context={{
						now: undefined,
						hourFormat: "24h",
						voice: previewVoiceContext,
						hardware: snapshot,
						keyTarget: {
							deviceId: "user-serial",
							profileId: "p",
							pageId: "1",
							revision: 0,
						},
					}}
				/>
			</AppLocaleProvider>,
		);
	return {
		bridge,
		request,
		render,
		fail: () => {
			failure = true;
		},
		save: (status: typeof saveStatus) => {
			saveStatus = status;
		},
	};
}
async function click(text: string) {
	const button = Array.from(host.querySelectorAll("button")).find(
		(b) => b.textContent === text,
	);
	if (!button) throw new Error(`Missing button ${text}`);
	await act(async () => button.click());
}
it("all eight locales update mounted hardware/QMK/game copy, accessible names and existing failures without replacing drafts or refetching", async () => {
	const f = fixture();
	await act(async () => f.render());
	await click("Choose application"); // Typed failure must be visible, then retranslated.
	f.fail();
	await click("Refresh");
	await click("Save");
	await click("Gaming");
	const draft = host.querySelector<HTMLInputElement>(
		'[aria-label="Game target"]',
	);
	const color = host.querySelector('[aria-label="Color 1 Hue"]');
	const count = f.request.mock.calls.length;
	for (const { value: locale } of APP_LANGUAGES) {
		await act(async () => {
			await f.bridge.set(locale);
		});
		const t = strings[locale];
		for (const key of [
			"title",
			"mic",
			"luminance",
			"feedback",
			"color1",
			"hue",
			"saturation",
			"saveLighting",
			"saveSaved",
			"preferencesFailed",
			"chooseApplication",
			"chooseFile",
			"chooseFolder",
			"showForeground",
			"pickerFailed",
			"lightingFailed",
			"modeFailed",
		] as const)
			expect(host.textContent).toContain(t[key]);
		expect(host.textContent).toContain(
			t.controlRetry.replace("{code}", "QUAKE.HARDWARE.UNAVAILABLE"),
		);
		expect(
			host.querySelector("[aria-label]")?.getAttribute("aria-label"),
		).toBeTruthy();
		expect(host.querySelector(`[aria-label="${t.gameTarget}"]`)).toBe(draft);
		expect(draft?.value).toBe("/user/English <draft>.app");
		expect(host.querySelector(`[aria-label="${t.color1} ${t.hue}"]`)).toBe(
			color,
		);
		expect(
			host.querySelector("[aria-valuetext]")?.getAttribute("aria-valuetext"),
		).toBe(t.silent);
		expect(
			host.querySelector(`[aria-label="${t.decreaseLuminance}"]`),
		).not.toBeNull();
		expect(host.querySelector(`[aria-label="${t.gameMode}"]`)).not.toBeNull();
		expect(host.textContent).toContain("user-serial");
		expect(f.request).toHaveBeenCalledTimes(count);
	}
	expect(host.textContent).not.toContain("private raw failure");
	await act(async () => {
		await f.bridge.set("de");
	});
	expect(host.textContent).toContain("Gerätemikrofon");
	expect(host.textContent).not.toContain("Choose application");
});
it("lighting save states and picker cancellation, missing bridge and failed replies use current copy", async () => {
	const f = fixture();
	await act(async () => f.render());
	await act(async () => {
		await f.bridge.set("de");
	});
	for (const [status, key] of [
		["unknown", "saveUnknown"],
		["unsaved", "saveUnsaved"],
		["failed", "saveFailed"],
		["saved", "saveSaved"],
	] as const) {
		f.save(status);
		await click("Speichern");
		expect(host.textContent).toContain(strings.de[key]);
	}
	f.request.mockImplementationOnce(async () => ({ _tag: "cancelled" }));
	await click("Datei wählen");
	expect(host.textContent).not.toContain(strings.de.pickerFailed);
	f.request.mockImplementationOnce(async () => ({
		_tag: "gameTarget",
		path: "/user/Not translated.txt",
	}));
	await click("Ordner wählen");
	expect(
		host.querySelector<HTMLInputElement>('[aria-label="Spielziel"]')?.value,
	).toBe("/user/Not translated.txt");
	vi.stubGlobal("quakeHardware", undefined);
	await click("Anwendung wählen");
	expect(host.textContent).toContain(strings.de.pickerFailed);
	await act(async () => {
		await f.bridge.set("ja");
	});
	expect(host.textContent).toContain(strings.ja.pickerFailed);
});
it("loading and offline copy follows language while the same hardware read remains pending", async () => {
	const f = fixture();
	let finish: ((reply: unknown) => void) | undefined;
	const ordinary = f.request.getMockImplementation();
	if (!ordinary) throw new Error("Missing hardware fixture");
	f.request.mockImplementation((command) =>
		command._tag === "read"
			? new Promise((resolve) => {
					finish = resolve;
				})
			: ordinary(command),
	);
	await act(async () => f.render());
	expect(host.textContent).toContain(strings.en.loading);
	const count = f.request.mock.calls.length;
	await act(async () => {
		await f.bridge.set("de");
	});
	expect(host.textContent).toContain(strings.de.loading);
	expect(f.request).toHaveBeenCalledTimes(count);
	await act(async () => finish?.({ _tag: "offline" }));
	expect(host.textContent).toContain(strings.de.offline);
	await act(async () => {
		await f.bridge.set("ko");
	});
	expect(host.textContent).toContain(strings.ko.offline);
});

it("V3 capabilities expose only speed and disable flash save in the mounted consumer", async () => {
	const speed = lighting.fields.find((field) => field.field === "effectSpeed");
	if (!speed) throw new Error("Missing speed fixture");
	const f = fixture({
		...lighting,
		canSave: false,
		fields: [
			{
				...speed,
				valueId: 3,
				evidence: {
					identity: { firmware: "QUAKE:3:1.0.19", protocolVersion: 12 },
					basis: "hardware-qualified",
				},
			},
		],
		values: [{ field: "effectSpeed", value: 156 }],
	});
	await act(async () => f.render());
	expect(
		host.querySelector<HTMLInputElement>('[aria-label="Effect speed"]')
			?.disabled,
	).toBe(false);
	expect(host.querySelector('[aria-label="Brightness"]')).toBeNull();
	expect(host.querySelector('[aria-label="Color 1 Hue"]')).toBeNull();
	const save = Array.from(host.querySelectorAll("button")).find(
		(b) => b.textContent === "Save",
	);
	expect(save?.disabled).toBe(true);
	const before = f.request.mock.calls.length;
	await act(async () => save?.click());
	expect(f.request.mock.calls.length).toBe(before);
});
