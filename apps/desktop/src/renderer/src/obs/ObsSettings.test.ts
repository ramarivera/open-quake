import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createEmptyProfileKey } from "../../../../../../packages/device/src/profiles/profile-contracts";
import type { ObsCatalog } from "../../../../../../packages/edge/src/obs/obs-contracts";
import { ObsSettings } from "./ObsSettings";

const state = vi.hoisted(() => {
	const catalog: ObsCatalog = {
		scenes: [],
		inputs: [],
		transitions: [],
		items: [],
	};
	return { catalog };
});
vi.mock("react", async (original) => {
	const react = await original<typeof import("react")>();
	return {
		...react,
		useState: (initial: unknown) => [
			initial && typeof initial === "object" && "inputs" in initial
				? state.catalog
				: initial,
			() => {},
		],
	};
});
const render = (type: string, settings: unknown = {}) => {
	const empty = createEmptyProfileKey("1,1");
	return renderToStaticMarkup(
		createElement(ObsSettings, {
			keyValue: {
				...empty,
				config: {
					...empty.config,
					type,
					actions: [{ type: "configData", value: JSON.stringify(settings) }],
				},
			},
			locale: "en",
			onChange: () => {},
		}),
	);
};
for (const type of ["obsMute", "obsVolume", "obsAudioMonitor"]) {
	it(`${type} offers every audio-capable platform, media and plugin input`, () => {
		state.catalog = {
			scenes: [],
			transitions: [],
			items: [],
			inputs: [
				"ffmpeg_source",
				"vlc_source",
				"wasapi_input_capture",
				"wasapi_output_capture",
				"pulse_input_capture",
				"coreaudio_input_capture",
				"browser_source",
				"third_party_capture",
			]
				.map((inputKind) => ({
					inputUuid: inputKind,
					inputName: inputKind,
					inputKind,
					hasAudio: true,
				}))
				.concat([
					{
						inputUuid: "image_source",
						inputName: "image_source",
						inputKind: "image_source",
						hasAudio: false,
					},
				]),
		};
		const html = render(type, { inputUuid: "ffmpeg_source" });
		for (const input of state.catalog.inputs)
			expect(html.includes(`<option value="${input.inputUuid}"`)).toBe(
				input.hasAudio,
			);
		expect(html).toContain('<option value="ffmpeg_source" selected="">');
	});
}
it("media offers FFmpeg and VLC inputs, excludes audio-only captures", () => {
	state.catalog = {
		scenes: [],
		transitions: [],
		items: [],
		inputs: [
			"ffmpeg_source",
			"vlc_source",
			"media_source",
			"wasapi_input_capture",
		].map((inputKind) => ({
			inputUuid: inputKind,
			inputName: inputKind,
			inputKind,
		})),
	};
	const html = render("obsMedia");
	for (const kind of ["ffmpeg_source", "vlc_source", "media_source"])
		expect(html).toContain(`<option value="${kind}"`);
	expect(html).not.toContain('<option value="wasapi_input_capture"');
});
it("keeps a saved non-selectable input visible for repair", () => {
	state.catalog = {
		scenes: [],
		transitions: [],
		items: [],
		inputs: [
			{
				inputUuid: "saved",
				inputName: "Silent source",
				inputKind: "image_source",
				hasAudio: false,
			},
		],
	};
	expect(
		render("obsVolume", { inputUuid: "saved", inputName: "Silent source" }),
	).toContain('<option value="saved" selected="">Silent source');
});
