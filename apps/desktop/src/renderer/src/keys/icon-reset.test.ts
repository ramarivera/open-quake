// @vitest-environment happy-dom
import { Option, Schema } from "effect";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as catalog from "../../../../../../packages/device/src/profiles/profile-catalog";
import type { KeyRequest } from "../../../shared/key-library";
import {
	type Profile,
	ProfileEnvelope,
	ProfileKey,
} from "../../../shared/profiles";
import { dispatch, mount, required } from "../test/mount";
import { TestResizeObserver } from "../test/resize-observer";
import { KeyEditor } from "./KeyEditor";
import { keyArtwork } from "./key-artwork";

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("ResizeObserver", TestResizeObserver);
	vi.stubGlobal("quakeAgents", {
		request: async () => ({
			_tag: "rejected",
			code: "test",
			message: "No saved models",
		}),
		onSnapshot: () => () => {},
		onProgress: () => () => {},
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function resetInEditor(
	profile: Profile,
	keyCode: string,
): Promise<ProfileKey> {
	const encoded = Schema.encodeSync(ProfileEnvelope)({
		schemaVersion: 1,
		manager: Option.none(),
		profiles: [profile],
		activeByDevice: {},
	});
	const calls: KeyRequest[] = [];
	window.quakeKeyLibrary = {
		request: async (command) => {
			calls.push(command);
			return { _tag: "success", envelope: encoded };
		},
		onRuntime: () => () => {},
		onPreview: () => () => {},
	};
	const view = await mount(createElement(KeyEditor));
	try {
		const select = Array.from(
			view.container.querySelectorAll(".keys-cells button"),
		).find((b) => b.textContent === keyCode);
		if (!select) throw new Error("Missing selection");
		await dispatch(select, new MouseEvent("click", { bubbles: true }));
		const button = required(
			view.container,
			'[aria-label="Reset icon to default"]',
			HTMLButtonElement,
		);
		expect(button.disabled).toBe(false);
		await dispatch(button, new MouseEvent("click", { bubbles: true }));
		const preview = calls
			.slice()
			.reverse()
			.find((c) => c.type === "preview");
		if (preview?.type !== "preview")
			throw new Error("Reset didn't reach preview bridge");
		expect(calls.some((c) => c.type === "save")).toBe(false);
		return Schema.decodeUnknownSync(ProfileKey)(preview.key);
	} finally {
		await view.unmount();
	}
}

it.each(["linux", "darwin", "win32"] as const)(
	"MGMT-340: %s editor resets Quick artwork using its own platform catalog",
	async (platform) => {
		vi.spyOn(navigator, "platform", "get").mockReturnValue(
			platform === "darwin"
				? "MacIntel"
				: platform === "win32"
					? "Win32"
					: "Linux x86_64",
		);
		const source = catalog
			.builtinProfiles(platform)
			.find((p) => p.id === "1-2");
		if (!source) throw new Error("Missing Quick");
		const lookup = vi.spyOn(catalog, "builtinProfiles");
		// User-unlocked imported templates without retained defaults must use the correct catalog.
		const changed: Profile = {
			...source,
			pages: [
				{
					...source.pages[0],
					keys: source.pages[0].keys.map((k) =>
						k.config.type
							? {
									...k,
									compatibility: Option.none(),
									config: {
										...k.config,
										icon: "data:image/png;base64,AA==",
										basicEditableItems: Option.none(),
										compatibility: Option.none(),
									},
								}
							: k,
					),
				},
			],
		};
		const key = await resetInEditor(changed, "1,8"),
			original = source.pages[0].keys.find((k) => k.keyCode === "1,8");
		if (!original) throw new Error("Missing source key");
		expect(lookup).toHaveBeenCalledWith(platform);
		expect(key.config.icon).toBe(
			keyArtwork(original.config.icon, key.config.type),
		);
		expect(Option.getOrUndefined(key.config.compatibility)?.iconSource).toBe(
			original.config.icon,
		);
		expect(key.config.actions).toEqual(original.config.actions);
		expect(key.config.title.text).toBe(original.config.title.text);
	},
);

it.each(["brightness", "plugin"])(
	"MGMT-255: %s reset precedence reaches the editor draft without saving",
	async (kind) => {
		const source = catalog.builtinProfiles("linux").find((p) => p.id === "1-2");
		if (!source) throw new Error("Missing Quick");
		const original = source.pages[0].keys.find(
			(k) => k.keyCode === (kind === "brightness" ? "2,1" : "1,6"),
		);
		if (!original) throw new Error("Missing key");
		const key = {
			...original,
			config: {
				...original.config,
				icon: "data:image/png;base64,AA==",
				alterIcon: Option.some("data:image/png;base64,AQ=="),
				compatibility: Option.some({
					defaultIcon: "data:image/png;base64,Ag==",
					defaultAlterIcon: "data:image/png;base64,Aw==",
				}),
			},
			compatibility: Option.some({
				source: {
					isPlugin: true,
					config: {
						defaultIcon: "data:image/png;base64,BA==",
						defaultAlterIcon: "data:image/png;base64,BQ==",
					},
				},
			}),
		};
		const edited = await resetInEditor(
			{
				...source,
				id: "custom-import",
				pages: [{ ...source.pages[0], keys: [key] }],
			},
			key.keyCode,
		);
		expect(edited.config.icon).toBe(
			kind === "brightness"
				? keyArtwork("0-1", "brightness")
				: "data:image/png;base64,Ag==",
		);
		expect(Option.getOrUndefined(edited.config.compatibility)?.iconSource).toBe(
			kind === "brightness" ? "0-1" : "data:image/png;base64,Ag==",
		);
		expect(Option.getOrUndefined(edited.config.alterIcon)).toBe(
			kind === "brightness"
				? "data:image/png;base64,AQ=="
				: "data:image/png;base64,Aw==",
		);
		expect(edited.config.actions).toEqual(original.config.actions);
	},
);

it("MGMT-340: an unlocked imported clock template resets to intentionally blank artwork", async () => {
	const source = catalog.builtinProfiles("linux").find((p) => p.id === "1-7");
	if (!source) throw new Error("Missing Clock");
	const original = source.pages[0].keys[0];
	if (!original) throw new Error("Missing clock key");
	const key = {
		...original,
		compatibility: Option.none(),
		config: {
			...original.config,
			icon: "data:image/png;base64,AA==",
			compatibility: Option.none(),
			basicEditableItems: Option.none(),
		},
	};
	const reset = await resetInEditor(
		{ ...source, pages: [{ ...source.pages[0], keys: [key] }] },
		key.keyCode,
	);
	expect(reset.config.icon).toBe("");
	expect(reset.config.actions).toEqual(original.config.actions);
});
