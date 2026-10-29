// @vitest-environment happy-dom

import { Schema } from "effect";
import { act } from "react";
import * as ReactDOM from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
	builtinProfiles,
	profileText,
	translateProfile,
} from "../../../../../../packages/device/src/profiles/profile-catalog";
import { Profile } from "../../../../../../packages/device/src/profiles/profile-contracts";
import {
	clockProfile,
	stripFixtureEnvelope,
} from "../../../main/test/strip-fixtures";
import type { ProfileBridge } from "../../../shared/profile-manager";

vi.mock("react-dom/client", async (importOriginal) => {
	const original = await importOriginal<typeof import("react-dom/client")>();
	return { ...original, createRoot: vi.fn(original.createRoot) };
});

it("renders a German thumbnail clock from the capture locale before marking the preview ready", async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(2026, 9, 26, 12));
	const savedUrl = location.href;
	history.replaceState(
		null,
		"",
		`/?surface=profile-thumbnail&profile=${clockProfile.id}&locale=de`,
	);
	const host = document.createElement("div");
	host.id = "root";
	document.body.append(host);
	const createRoot = vi.mocked(ReactDOM.createRoot);
	const localeRead = vi.fn();
	vi.stubGlobal("quakeLocale", { read: localeRead });
	const request = vi.fn<ProfileBridge["request"]>(async () => ({
		_tag: "success",
		view: {
			envelope: stripFixtureEnvelope(clockProfile),
			serials: [],
			apps: [],
			thumbnails: {},
			progress: { running: false, done: 0, total: 0, failed: 0 },
		},
	}));
	vi.stubGlobal("quakeProfileManager", {
		request,
		onSnapshot: () => () => {},
		onProgress: () => () => {},
		onSelection: () => () => {},
	} satisfies ProfileBridge);
	const readyText: string[] = [];
	const observer = new MutationObserver(() => {
		const preview = host.querySelector("[data-profile-ready]");
		if (preview) readyText.push(preview.textContent ?? "");
	});
	observer.observe(host, {
		childList: true,
		subtree: true,
		characterData: true,
	});
	try {
		await act(async () => {
			await import("../main");
		});
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		expect(request).toHaveBeenCalledWith({
			type: "read",
			locale: "de",
			preview: true,
		});
		expect(localeRead).not.toHaveBeenCalled();
		expect(host.querySelector("[data-profile-ready]")).not.toBeNull();
		expect(host.querySelector(".oq-clock-week")?.textContent).toBe("MO");
		expect(host.querySelector(".oq-clock-date")?.textContent).toBe("OKT 26");
		expect(host.querySelector(".oq-clock-nav-name")?.textContent).toBe(
			"Season",
		);
		expect(
			host
				.querySelector('[data-testid="clock-theme-prev"]')
				?.getAttribute("aria-label"),
		).toBe("Vorheriges Thema");
		expect(readyText.length).toBeGreaterThan(0);
		for (const text of readyText) {
			expect(text).toContain("OKT 26");
			expect(text).not.toContain("OCT 26");
		}
		expect(document.documentElement.lang).toBe("de");
	} finally {
		observer.disconnect();
		const root = createRoot.mock.results[0];
		if (root?.type === "return") await act(async () => root.value.unmount());
		host.remove();
		history.replaceState(null, "", savedUrl);
		vi.useRealTimers();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	}
});

it("pins hidden thumbnail borders to capture identity despite saved and live setting changes", async () => {
	const { ProfileThumbnail } = await import("./ProfileViews");
	const { mount } = await import("../../test/dom");
	const url = location.href;
	const storageKey = "open-quake.strip.v1";
	localStorage.setItem(
		storageKey,
		JSON.stringify({ version: 1, showEmptyGridDashedBorder: true }),
	);
	history.replaceState(
		null,
		"",
		`/?surface=profile-thumbnail&profile=${clockProfile.id}&locale=en&emptyBorders=false`,
	);
	vi.stubGlobal("quakeProfileManager", {
		request: async () => ({
			_tag: "success",
			view: {
				envelope: stripFixtureEnvelope(clockProfile),
				serials: [],
				apps: [],
				thumbnails: {},
				progress: { running: false, done: 0, total: 0, failed: 0 },
			},
		}),
	});
	const { host, close } = await mount(<ProfileThumbnail />);
	try {
		expect(
			host.querySelector(".strip-screen")?.getAttribute("data-dashed"),
		).toBe("false");
		await act(async () => {
			window.dispatchEvent(
				new StorageEvent("storage", {
					key: storageKey,
					newValue: JSON.stringify({
						version: 1,
						showEmptyGridDashedBorder: true,
					}),
				}),
			);
		});
		expect(
			host.querySelector(".strip-screen")?.getAttribute("data-dashed"),
		).toBe("false");
	} finally {
		await close();
		history.replaceState(null, "", url);
		localStorage.clear();
		vi.unstubAllGlobals();
	}
});

it("renders persisted old English defaults in German thumbnails and preserves explicit edits", async () => {
	const { ProfileThumbnail } = await import("./ProfileViews");
	const { mount } = await import("../../test/dom");
	const profile = builtinProfiles("darwin").find((p) => p.id === "1-5");
	const key = profile?.pages[0].keys.find(
		(k) => k.config.title.text === "Content writer",
	);
	if (!profile || !key) throw new Error("Missing chat fixture");
	const saved = Schema.decodeUnknownSync(Profile)(
		Schema.encodeSync(Profile)({
			...profile,
			pages: [
				{
					...profile.pages[0],
					keys: profile.pages[0].keys.map((k) =>
						k === key
							? {
									...k,
									config: {
										...k.config,
										title: { ...k.config.title, text: "Content Writer" },
									},
								}
							: { ...k, config: { ...k.config, userModifiedTitle: true } },
					),
				},
			],
		}),
	);
	const url = location.href;
	history.replaceState(
		null,
		"",
		"/?surface=profile-thumbnail&profile=1-5&locale=de",
	);
	vi.stubGlobal("quakeProfileManager", {
		request: async () => ({
			_tag: "success",
			view: {
				envelope: stripFixtureEnvelope(
					Schema.encodeSync(Profile)(translateProfile(saved, "de")),
				),
				serials: [],
				apps: [],
				thumbnails: {},
				progress: { running: false, done: 0, total: 0, failed: 0 },
			},
		}),
	});
	const { host, close } = await mount(<ProfileThumbnail />);
	try {
		expect(host.querySelector("[data-profile-ready]")).not.toBeNull();
		expect(host.textContent).toContain(
			profileText("defaultAiCopilotChatConfig.contentWriter", "de"),
		);
		expect(host.textContent).not.toContain("Content Writer");
		expect(
			saved.pages[0].keys.find((k) => k.keyCode === key.keyCode)?.config.title
				.text,
		).toBe("Content Writer");
		expect(host.textContent).toContain("Compliance");
	} finally {
		await close();
		history.replaceState(null, "", url);
		vi.unstubAllGlobals();
	}
});
