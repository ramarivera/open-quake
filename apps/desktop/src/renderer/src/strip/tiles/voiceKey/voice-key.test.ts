import { Option, Schema } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	copilotProfile,
	dkClawProfile,
	voiceFixtureEnvelope,
} from "../../../../../main/test/voice-fixtures";
import { ProfileEnvelope } from "../../../../../shared/profiles";
import { KeyAlert } from "../../overlays/voice/KeyDecorations";
import { previewVoiceContext } from "../../overlays/voice/voice-context";
import { initialVoiceView } from "../../overlays/voice/voice-state";
import { StripScreen } from "../../StripScreen";
import { stripTileFor } from "../../tileRegistry";
import { AiCopilotTile } from "../aiCopilot/AiCopilotTile";
import { ClawBotTile } from "../clawBot/ClawBotTile";
import { ClawBotInputTile } from "../clawBotInput/ClawBotInputTile";
import { VoiceKeyTile } from "./VoiceKeyTile";

const profiles = (active: typeof copilotProfile) => ({
	_tag: "ready" as const,
	envelope: Schema.decodeUnknownSync(ProfileEnvelope)(
		voiceFixtureEnvelope(active),
	),
});

describe("voice tiles on the strip", () => {
	it("registers the AI tiles", () => {
		expect(stripTileFor("aiChatView")).toBe(AiCopilotTile);
		expect(stripTileFor("quakeBot")).toBe(ClawBotTile);
		expect(stripTileFor("quakeBotInput")).toBe(ClawBotInputTile);
		expect(stripTileFor("aiChat")).toBe(VoiceKeyTile);
		expect(stripTileFor("clawbot")).toBe(VoiceKeyTile);
	});

	it("shows the cancel indicator on the processing key and hides its icon", () => {
		const view = {
			...initialVoiceView,
			copilot: {
				...initialVoiceView.copilot,
				status: Option.some(1 as const),
				activeKey: Option.some("1,6"),
			},
		};
		const markup = renderToStaticMarkup(
			createElement(StripScreen, {
				profiles: profiles(copilotProfile),
				showEmptyGridDashedBorder: true,
				voice: { ...previewVoiceContext, view, surface: "panel" },
			}),
		);
		expect(markup.match(/voice-cancel-indicator/g)).toHaveLength(1);
		expect(markup).toContain('data-cancel="true"');
		expect(markup).toContain('fill="var(--strip-danger)"');
		expect(markup).toContain('stroke="var(--strip-danger)"');
		expect(markup).toContain("Press ");
	});

	it("dots the selected clawbot key and draws key alerts through the tile hook", () => {
		const view = { ...initialVoiceView, activeClawbot: Option.some("1,5") };
		const markup = renderToStaticMarkup(
			createElement(StripScreen, {
				profiles: profiles(dkClawProfile),
				showEmptyGridDashedBorder: true,
				voice: { ...previewVoiceContext, view, surface: "panel" },
				tileOverlay: (tile) =>
					tile.keyCode === "1,6"
						? createElement(KeyAlert, { alert: "invalid" })
						: null,
			}),
		);
		expect(markup.match(/voice-clawbot-dot/g)).toHaveLength(1);
		expect(markup).toContain('data-alert="invalid"');
		expect(markup).toContain("Interaction History");
		expect(markup).toContain("Command Input");
	});
});
