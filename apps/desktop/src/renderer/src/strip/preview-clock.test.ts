import { Option, Schema } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	clockProfile,
	stripFixtureEnvelope,
} from "../../../main/test/strip-fixtures";
import { ProfileEnvelope } from "../../../shared/profiles";
import { ProfilePreview } from "../profiles/ProfileViews";
import { DeviceScreen } from "../ui/DeviceScreen";
import { useClockSettings } from "./tiles/clock/useClockSettings";
import { useStripProfiles } from "./useStripProfiles";

vi.mock("./useStripProfiles", () => ({ useStripProfiles: vi.fn() }));
vi.mock("./tiles/clock/useClockSettings", async (original) => ({
	...(await original<typeof import("./tiles/clock/useClockSettings")>()),
	useClockSettings: vi.fn(() => {
		throw new Error("Passive preview requested the live clock bridge");
	}),
}));
const envelope = Schema.decodeUnknownSync(ProfileEnvelope)(
	stripFixtureEnvelope(clockProfile),
);
const profile = envelope.profiles.find((p) => p.id === clockProfile.id);
if (!profile) throw new Error("missing clock fixture");
vi.mocked(useStripProfiles).mockReturnValue({
	_tag: "ready",
	envelope: { ...envelope, manager: Option.none() },
});

describe("passive management clock hosts", () => {
	for (const [name, element] of [
		["Overview bezel", createElement(DeviceScreen, { key: "overview" })],
		[
			"profile preview",
			createElement(ProfilePreview, { profile, key: "profile" }),
		],
	] as const) {
		it(`${name} paints a clock without mounting live clock/weather consumers`, () => {
			const markup = renderToStaticMarkup(element);
			expect(markup).toContain('class="oq-clock"');
			expect(markup).toContain('inert=""');
			expect(useClockSettings).not.toHaveBeenCalled();
		});
	}
});
