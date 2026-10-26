import { Schema } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { meetAiProfile } from "../../../main/test/strip-fixtures";
import { voiceFixtureEnvelope } from "../../../main/test/voice-fixtures";
import { ProfileEnvelope } from "../../../shared/profiles";
import { stripLayout } from "../strip/geometry";
import { selectStripPage } from "../strip/selection";
import { SelectedKeyPreview } from "./SelectedKeyPreview";

vi.mock("../strip/tileRegistry", () => ({
	stripTileFor: () => () =>
		createElement("button", { type: "button" }, "Meeting action"),
}));
it("puts live tile buttons inside an inert subtree, keeping clock controls outside", () => {
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)(
		voiceFixtureEnvelope(meetAiProfile, "fake"),
	);
	const { profile, page } = selectStripPage(envelope, "fake");
	const tile = stripLayout(profile, page).tiles[0];
	if (!tile) throw new Error("Missing tile");
	const render = (clock: boolean) =>
		renderToStaticMarkup(
			createElement(SelectedKeyPreview, {
				tile: clock ? { ...tile, type: "dkDesktopClock" } : tile,
				target: {
					profileId: profile.id,
					pageId: page.id,
					keyCode: tile.key.keyCode,
				},
				beforeWrite: async () => true,
				onSaved: async () => {},
			}),
		);
	const html = render(false);
	expect(html).toMatch(/<div[^>]*inert=""[^>]*data-preview-width/);
	expect(html).toContain("Meeting action</button>");
	const clock = render(true);
	expect(clock).toMatch(
		/<\/div><\/div><div class="key-selected-preview-controls">/,
	);
	expect(clock).toContain('aria-label="Next clock theme"');
});
