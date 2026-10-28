import microphoneOff from "@phosphor-icons/core/assets/regular/microphone-slash.svg?raw";
import sun from "@phosphor-icons/core/assets/regular/sun.svg?raw";
import { expect, it } from "vitest";
import { resolveTileArtwork, validatedArtwork } from "../strip/useTileArt";
import { hasSemanticKeyArtwork, keyArtwork } from "./key-artwork";

const data = (svg: string): string =>
	`data:image/svg+xml,${encodeURIComponent(svg.replace('fill="currentColor"', 'fill="white"'))}`;

it.each(["constructor", "toString", "__proto__"])(
	"ignores inherited artwork properties named %s",
	(name) => {
		const fallback = keyArtwork("unmapped", "unmapped");
		expect(keyArtwork(name, "unmapped")).toBe(fallback);
		expect(keyArtwork("unmapped", name)).toBe(fallback);
		expect(keyArtwork(name, name)).toBe(fallback);
		expect(hasSemanticKeyArtwork(name, name)).toBe(false);
		expect(keyArtwork(name, "brightness")).toBe(data(sun));
		expect(keyArtwork("0-1", name)).toBe(data(sun));
	},
);

it("gives panelBrightness library entries the Phosphor brightness default", async () => {
	expect(
		hasSemanticKeyArtwork("library:panelBrightness:1", "panelBrightness"),
	).toBe(true);
	expect(
		await resolveTileArtwork("library:panelBrightness:1", "panelBrightness"),
	).toBe(data(sun));
});

it("uses Phosphor microphone mute for Discord mic mute and the mic off-state", async () => {
	for (const id of ["0-103", "0-100"])
		expect(await resolveTileArtwork(id, "hotkey")).toBe(data(microphoneOff));
	expect(keyArtwork("0-103", "hotkey")).not.toBe(keyArtwork("0-102", "hotkey"));
	expect(keyArtwork("0-100", "mic")).not.toBe(keyArtwork("0-59", "mic"));
	expect(keyArtwork("0-101", "buzzer")).not.toBe(keyArtwork("0-58", "buzzer"));
});

it("keeps numeric and library references valid and preserves custom artwork", async () => {
	for (const source of ["0-1", "library:brightness:1"]) {
		const artwork = await resolveTileArtwork(source, "brightness");
		expect(artwork).toBe(data(sun));
		expect(validatedArtwork(artwork)).toBe(artwork);
		const svg = decodeURIComponent(artwork.split(",")[1] ?? "");
		expect(svg.match(/fill=/g)).toHaveLength(1);
	}
	const custom = "data:image/png;base64,AAAA";
	expect(keyArtwork(custom, "hotkey")).toBe(custom);
	expect(await resolveTileArtwork(custom, "hotkey")).toBe(custom);
});
