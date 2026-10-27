// @vitest-environment happy-dom
import { Option } from "effect";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { keyText } from "../../../../../../packages/device/src/profiles/key-editing-invariants";
import { profileText } from "../../../../../../packages/device/src/profiles/profile-catalog";
import {
	createEmptyProfileKey,
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	type ProfileEnvelope,
} from "../../../../../../packages/device/src/profiles/profile-contracts";
import type {
	ClockBridge,
	ClockSnapshot,
} from "../../../shared/clock-contracts";
import type {
	KnobModelSnapshot,
	MenuProfile,
} from "../../../shared/knob-contracts";
import {
	APP_LANGUAGES,
	type AppLocaleBridge,
	type LocaleSnapshot,
} from "../../../shared/locale";
import { DEFAULT_WEATHER_SETTINGS } from "../../../shared/weather-media-contracts";
import { LanguageControl } from "../management/LanguageControl";
import { ProfilesManager } from "../profiles/ProfileViews";
import { RegionSuggestions } from "../settings/RegionSuggestions";
import {
	TRANSLATION_LANGUAGES,
	TranslationLanguageSelect,
} from "../settings/TranslationLanguageSelect";
import { ProfilePicker } from "../strip/overlays/knob/ProfilePicker";
import { stripText } from "../strip/overlays/voice/strings";
import { useVoiceSurface } from "../strip/overlays/voice/useVoiceSurface";
import { StripScreen } from "../strip/StripScreen";
import { ClockSettings } from "../strip/tiles/clock/ClockSettings";
import { ClockMusicCard, ClockWeatherCard } from "../weather-media/ClockCards";
import { ClockEnrichmentSettings } from "../weather-media/WeatherMediaSettings";
import { AppLocaleProvider, resolveAppLocale } from "./index";
import recovered from "./recovered.json";

const roots: Root[] = [];
afterEach(async () => {
	await act(async () => {
		for (const root of roots.splice(0)) root.unmount();
	});
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});
function mounted(node: ReactNode) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	roots.push(root);
	root.render(node);
	return host;
}
function localeBridge() {
	let snapshot: LocaleSnapshot = { locale: "en", revision: 0 };
	const listeners = new Set<(next: LocaleSnapshot) => void>();
	const bridge: AppLocaleBridge = {
		read: async () => snapshot,
		set: async (locale) => {
			snapshot = { locale, revision: snapshot.revision + 1 };
			for (const listener of listeners) listener(snapshot);
			return snapshot;
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose: async () => {},
	};
	return bridge;
}
const entry: MenuProfile = {
	id: "p",
	name: "User <profile>",
	colorful: false,
	thumbnail: { _tag: "missing" },
};
const entries: readonly MenuProfile[] = [entry];
const picker: KnobModelSnapshot = {
	context: {
		session: { deviceId: "mock", sessionId: "s", profileId: "p", revision: 0 },
		profiles: entries,
		keys: [],
		player: false,
	},
	revision: 0,
	selector: {
		mode: "picker",
		index: 0,
		page: 0,
		progress: 0,
		ringVisible: false,
		direction: 1,
	},
	focus: { _tag: "none" },
	volume: { phase: "inactive", level: 0, muted: false },
	notice: "",
};
function VoiceProbe() {
	const { context } = useVoiceSurface(undefined);
	return (
		<p data-voice={context.locale}>
			{stripText(context.locale, "aiAudio.speakNow")}
		</p>
	);
}
const key = createEmptyProfileKey("1,1");
const envelope: ProfileEnvelope = {
	...createInitialProfileEnvelope(),
	profiles: [
		{
			...createInitialProfileEnvelope().profiles[0],
			id: "p",
			name: "User <profile>",
			pages: [
				{
					id: "page",
					compatibility: Option.none(),
					keys: [
						{
							...key,
							config: {
								...key.config,
								type: "aiChat",
								title: { ...key.config.title, text: "Content Writer" },
							},
						},
					],
				},
			],
		},
	],
};

it("CENTER-006 MGMT-327 SCREEN-011/099 SETTINGS-007/063/064: saved locale updates mounted management, strip, voice and picker without losing drafts", async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const bridge = localeBridge();
	const reads: string[] = [];
	vi.stubGlobal("quakeProfileManager", {
		request: async (command) => {
			const locale = "locale" in command ? (command.locale ?? "en") : "en";
			reads.push(locale);
			return {
				_tag: "success",
				view: {
					envelope: encodeProfileEnvelope({
						...createInitialProfileEnvelope(),
						// Locale propagation needs one row; real catalog geometry is covered in strip.test.ts.
						profiles: createInitialProfileEnvelope().profiles,
					}),
					serials: [],
					apps: [],
					thumbnails: {},
					progress: { running: false, done: 0, total: 0, failed: 0 },
				},
			};
		},
		onSnapshot: () => () => {},
		onProgress: () => () => {},
		onSelection: () => () => {},
	} satisfies NonNullable<Window["quakeProfileManager"]>);
	let management: HTMLDivElement | undefined, panel: HTMLDivElement | undefined;
	await act(async () => {
		management = mounted(
			<AppLocaleProvider bridge={bridge}>
				<LanguageControl name="language" labelledBy="language" />
				<ProfilesManager />
				<input data-draft defaultValue="Keep me" />
				<TranslationLanguageSelect value="yue" onChange={() => {}} />
			</AppLocaleProvider>,
		);
		panel = mounted(
			<AppLocaleProvider bridge={bridge}>
				<StripScreen
					profiles={{ _tag: "ready", envelope }}
					showEmptyGridDashedBorder={false}
				/>
				<VoiceProbe />
				<ProfilePicker
					snapshot={picker}
					entries={entries}
					request={async () => {}}
				/>
			</AppLocaleProvider>,
		);
	});
	const draft = management?.querySelector<HTMLInputElement>("[data-draft]");
	if (!draft || !panel || !management)
		throw new Error("Missing mounted consumer");
	draft.value = "Unsaved <edit>";
	for (const locale of [
		...APP_LANGUAGES.map((entry) => entry.value),
		resolveAppLocale("unknown-ZZ"),
	]) {
		await act(async () => {
			await bridge.set(locale);
		});
		expect(
			panel
				.querySelector('[data-testid="profile-picker"]')
				?.getAttribute("aria-label"),
		).toBe(recovered[locale].picker.title);
		expect(panel.textContent).toContain(recovered[locale].picker.currentPrefix);
		expect(panel.textContent).toContain(recovered[locale].picker.currentBadge);
		expect(panel.textContent).toContain(recovered[locale].picker.knobHint);
		expect(panel.querySelector("[data-voice]")?.textContent).toBe(
			stripText(locale, "aiAudio.speakNow"),
		);
		expect(panel.textContent).toContain(
			keyText("defaultAiCopilotChatConfig.contentWriter", locale),
		);
		expect(management.textContent).toContain(
			profileText("functionWheelEditor.title", locale),
		);
		expect(reads.at(-1)).toBe(locale);
		expect(document.documentElement.lang).toBe(locale);
		expect(management.querySelector("[data-draft]")).toBe(draft);
		expect(draft.value).toBe("Unsaved <edit>");
		expect(
			management.querySelector<HTMLSelectElement>('select option[value="yue"]')
				?.textContent,
		).toBe(recovered[locale].translationLanguages.yue);
	}
	expect(envelope.profiles[0]?.pages[0]?.keys[0]?.config.title.text).toBe(
		"Content Writer",
	);
});

it("WIDGETS-063 SETTINGS-067: all eight rendered clock/settings/enrichment labels and eighteen translation options remain offline", async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	const fetch = vi.fn(() => Promise.reject(new Error("Offline")));
	vi.stubGlobal("fetch", fetch);
	const bridge = localeBridge();
	const clockSnapshot: ClockSnapshot = {
		revision: 0,
		keyCode: "1,1",
		mode: "theme",
		themeId: "season",
		showSeconds: false,
		media: {},
		recovered: true,
	};
	const clockBridge: ClockBridge = {
		request: async (command) =>
			command._tag === "read"
				? { _tag: "success", snapshot: clockSnapshot }
				: {
						_tag: "failure",
						code: "QUAKE.CLOCK.PERSISTENCE_FAILED",
						message: "Private original failure",
					},
		onSnapshot: () => () => {},
	};
	vi.stubGlobal("quakeClock", clockBridge);
	let host: HTMLDivElement | undefined;
	await act(async () => {
		host = mounted(
			<AppLocaleProvider bridge={bridge}>
				<ClockSettings />
				<ClockWeatherCard
					city="<Berlin>"
					unit="celsius"
					state={{
						kind: "ready",
						temperature: 20,
						weatherCode: 0,
						description: "user weather",
						high: 21,
						low: 10,
						stale: true,
					}}
				/>
				<ClockWeatherCard city="" unit="celsius" state={{ kind: "loading" }} />
				<ClockMusicCard
					snapshot={{ revision: 0, session: null, error: null }}
					control={async () => false}
				/>
				<ClockEnrichmentSettings initial={DEFAULT_WEATHER_SETTINGS} />
				<TranslationLanguageSelect value="yue" onChange={() => {}} />
				<RegionSuggestions region="CN" />
				<ProfilePicker
					snapshot={picker}
					entries={Array.from({ length: 16 }, (_, index) => ({
						...entry,
						id: `p${index}`,
					}))}
					request={async () => {}}
				/>
			</AppLocaleProvider>,
		);
	});
	if (!host) throw new Error("Missing clock consumer");
	const mediaButton = host.querySelector<HTMLButtonElement>(
		".clock-theme-card .button",
	);
	if (!mediaButton) throw new Error("Missing real clock media control");
	await act(async () => {
		mediaButton.click();
	});
	for (const { value: locale } of APP_LANGUAGES) {
		await act(async () => {
			await bridge.set(locale);
		});
		for (const key of [
			"title",
			"seconds",
			"secondsHint",
			"description",
			"themeDescription",
			"theme",
			"on",
			"off",
			"selected",
			"recovered",
			"high",
			"low",
			"cached",
			"saveFailed",
			"ipLookup",
			"ipConsent",
		] as const) {
			expect(host.textContent).toContain(recovered[locale].clock[key]);
		}
		expect(host.textContent).toContain(recovered[locale].picker.pageHint);
		const select = host.querySelector(
			'select option[value="yue"]',
		)?.parentElement;
		expect(select?.querySelectorAll("option")).toHaveLength(18);
		for (const code of TRANSLATION_LANGUAGES)
			expect(
				select?.querySelector(`option[value="${code}"]`)?.textContent,
			).toBe(recovered[locale].translationLanguages[code]);
		expect(host.textContent).toContain("<Berlin>");
		expect(host.querySelector("Berlin")).toBeNull();
	}
	expect(host.textContent).not.toContain("Private original failure");
	expect(fetch).not.toHaveBeenCalled();
});
