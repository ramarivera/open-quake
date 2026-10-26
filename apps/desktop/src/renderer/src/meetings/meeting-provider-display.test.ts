// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
	appendTranslation,
	timeline,
} from "../../../../../../packages/edge/src/meetings/meeting-invariants";
import { defaultMeetingConfig } from "../../../shared/meeting-bridge";
import { MeetingDisplay } from "../strip/tiles/meeting/MeetingDisplay";
import { meetingFailure } from "./meeting-failure";
import { meetingDom, meetingTile } from "./meeting-test-fixture";

let dom: ReturnType<typeof meetingDom>;
afterEach(async () => {
	await dom?.close();
	vi.useRealTimers();
});
it("SCREEN-110 AI-338 fans incremental results to two mounted keys, scrolls, keeps language/speaker and becomes idle", async () => {
	vi.useFakeTimers();
	vi.setSystemTime(10000);
	const scroll = vi.fn();
	Object.defineProperty(HTMLElement.prototype, "scrollTo", {
		configurable: true,
		value: scroll,
	});
	dom = meetingDom([], {
		tab: "live",
		translating: true,
		config: { ...defaultMeetingConfig, targetLanguage: "de" },
	});
	const props = meetingTile();
	await dom.render(
		createElement(
			"div",
			{},
			createElement(MeetingDisplay, { ...props, key: "one" }),
			createElement(MeetingDisplay, {
				...props,
				key: "two",
				tile: { ...props.tile, keyCode: "2,2" },
			}),
		),
	);
	let translations = appendTranslation([], {
		id: "correlated",
		speaker: "2",
		text: "Guten",
		final: false,
		at: 10000,
	});
	await dom.push({ translations });
	expect(
		dom.host.querySelectorAll('.meeting-translations[lang="de"]'),
	).toHaveLength(2);
	expect(dom.host.querySelectorAll('p[data-final="false"]')).toHaveLength(2);
	expect(dom.host.textContent).toContain("Speaker 2");
	translations = appendTranslation(translations, {
		id: "correlated",
		speaker: "2",
		text: "Guten Morgen",
		final: true,
		at: 10300,
	});
	await dom.push({ translations });
	expect(dom.host.querySelectorAll('p[data-final="true"]')).toHaveLength(2);
	expect(dom.host.querySelectorAll(".meeting-translations p")).toHaveLength(2);
	expect(scroll).toHaveBeenCalled();
	await act(async () => {
		await vi.advanceTimersByTimeAsync(5400);
	});
	for (const footer of dom.host.querySelectorAll('footer[role="status"]'))
		expect(footer.textContent).toBe("Update speed : - -");
	await dom.push({
		translations: [],
		translating: false,
		config: { ...defaultMeetingConfig, targetLanguage: "ja" },
	});
	expect(dom.host.textContent).not.toContain("Guten Morgen");
	expect(dom.host.textContent).toContain("Live translation is off");
});
it("AI-338 bounds visible history and timeline under long provider streams", () => {
	let current: Parameters<typeof appendTranslation>[0] = [];
	for (let i = 0; i < 1000; i++)
		current = appendTranslation(current, {
			id: String(i),
			speaker: "1",
			text: "x".repeat(5000),
			at: i * 3000,
			final: true,
		});
	expect(current.length).toBeLessThanOrEqual(200);
	expect(current.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(
		64000,
	);
	expect(timeline(current).length).toBeLessThanOrEqual(8);
});
it.each([
	"AUDIO_MISSING",
	"AUDIO_EXPIRED",
	"TRANSCRIPT_MISSING",
	"NO_VALID_SPEECH",
])("AI-279 maps %s to distinct localized actionable errors", (suffix) => {
	const code = `QUAKE.MEETING.${suffix}`;
	expect(meetingFailure(code, "fallback", "en")).not.toBe("fallback");
	expect(meetingFailure(code, "fallback", "de")).not.toBe(
		meetingFailure(code, "fallback", "en"),
	);
});
