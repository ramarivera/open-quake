// @vitest-environment happy-dom
import { Option } from "effect";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	click,
	element,
	epoch,
	meetingDom,
	meetingRecord,
	meetingTile,
} from "../../../meetings/meeting-test-fixture";
import { MeetingDisplay } from "./MeetingDisplay";
import { MeetingKey } from "./MeetingKey";

let dom: ReturnType<typeof meetingDom>;
afterEach(async () => {
	await dom?.close();
	vi.useRealTimers();
});
const advance = async (ms: number) => {
	await act(async () => {
		vi.advanceTimersByTime(ms);
	});
};
const view = () => createElement(MeetingDisplay, meetingTile());
const animation = () => dom.host.querySelector(".meeting-animation");
const complete = (index: number, at: number) =>
	meetingRecord(index, {
		provenance: Option.some({
			profileId: meetingRecord().config.profileId,
			model: "fake",
			language: "English",
			generatedAt: at,
		}),
	});

describe("mounted MeetAI consumers", () => {
	it("AI-321 timer waits for capture readiness, rolls over an hour, remounts and stops", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(epoch);
		dom = meetingDom();
		const key = () => createElement(MeetingKey, meetingTile("meetingMinutes"));
		await dom.render(key());
		expect(element(".meeting-key-timer").textContent).toBe("00:00:00");
		await advance(10000);
		expect(element(".meeting-key-timer").textContent).toBe("00:00:00");
		const record = meetingRecord(1, {
			state: "recording",
			startedAt: epoch + 10000,
			endedAt: Option.none(),
		});
		await dom.push({ records: [record] });
		await advance(3599900);
		expect(element(".meeting-key-timer").textContent).toBe("00:59:59");
		await advance(100);
		expect(element(".meeting-key-timer").textContent).toBe("01:00:00");
		await dom.render(null);
		await advance(1100);
		await dom.render(key());
		expect(element(".meeting-key-timer").textContent).toBe("01:00:01");
		await dom.push({
			records: [
				{ ...record, state: "recorded", endedAt: Option.some(Date.now()) },
			],
		});
		await advance(1000);
		expect(element(".meeting-key-timer").textContent).toBe("00:00:00");
		expect(element(".meeting-key").getAttribute("aria-pressed")).toBe("false");
		expect(dom.capture).not.toHaveBeenCalled();
	});

	it.each([
		"meetingMinutes",
		"tempMeetingMinutes",
		"meetingRecordMark",
		"liveAudioTranslate",
	])(
		"AI-322 %s sweeps clockwise at 0/2500/5000ms and dispatches the saved coordinate",
		async (type) => {
			vi.useFakeTimers();
			vi.setSystemTime(epoch);
			dom = meetingDom(
				[meetingRecord(1, { state: "recording", endedAt: Option.none() })],
				{ cooldowns: { [type]: epoch + 5000 } },
			);
			const props = meetingTile(type);
			await dom.render(createElement(MeetingKey, props));
			expect(element(".meeting-key").getAttribute("aria-disabled")).toBe(
				"true",
			);
			expect(element(".meeting-cooldown").getAttribute("style")).toContain(
				"from 0deg, transparent 0deg 0deg, #0008 0deg 360deg",
			);
			await advance(2500);
			expect(element(".meeting-cooldown").getAttribute("style")).toContain(
				"transparent 0deg 180deg, #0008 180deg 360deg",
			);
			await advance(2500);
			expect(dom.host.querySelector(".meeting-cooldown")).toBeNull();
			expect(element(".meeting-key").getAttribute("aria-disabled")).toBe(
				"false",
			);
			await click(".meeting-key");
			expect(dom.request).toHaveBeenLastCalledWith({
				_tag: "action",
				action: type,
				keyCode: props.tile.keyCode,
			});
		},
	);

	it("MGMT-365 saved Mark consumes open/closed ranges and increments its counter", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(epoch);
		const record = meetingRecord(1, {
			state: "recording",
			endedAt: Option.none(),
		});
		dom = meetingDom([record]);
		await dom.render(
			createElement(MeetingKey, meetingTile("meetingRecordMark")),
		);
		expect(dom.host.querySelector(".meeting-mark-count")).toBeNull();
		await click(".meeting-key");
		expect(dom.request).toHaveBeenLastCalledWith({
			_tag: "action",
			action: "meetingRecordMark",
			keyCode: "2,8",
		});
		await dom.push({
			records: [
				{ ...record, marks: [{ startMs: 1000, endMs: Option.none() }] },
			],
			cooldowns: { meetingRecordMark: epoch + 5000 },
		});
		expect(element(".meeting-mark-count").textContent).toBe("1");
		expect(element(".meeting-mark-count").getAttribute("data-open")).toBe(
			"true",
		);
		expect(element(".meeting-key").getAttribute("aria-disabled")).toBe("true");
		await advance(5000);
		await dom.push({
			records: [
				{
					...record,
					marks: [
						{ startMs: 1000, endMs: Option.some(5000) },
						{ startMs: 6000, endMs: Option.none() },
					],
				},
			],
		});
		expect(element(".meeting-mark-count").textContent).toBe("2");
		await dom.push({
			records: [
				{
					...record,
					marks: [
						{ startMs: 1000, endMs: Option.some(5000) },
						{ startMs: 6000, endMs: Option.some(7000) },
					],
				},
			],
		});
		expect(element(".meeting-mark-count").getAttribute("data-open")).toBe(
			"false",
		);
	});

	it("AI-329 authoritative recording is animated only in the main tab", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(epoch);
		const main = meetingRecord(1, {
			state: "recording",
			endedAt: Option.none(),
			minutes: "",
		});
		const side = meetingRecord(2, {
			parentId: Option.some(main.id),
			state: "recording",
			endedAt: Option.none(),
			minutes: "",
		});
		dom = meetingDom([main, side], {
			progress: {
				[main.id]: { stage: 0, status: 1 },
				[side.id]: { stage: 0, status: 1 },
			},
		});
		await dom.render(view());
		expect(animation()?.getAttribute("data-animation")).toBe("recording");
		expect(animation()?.textContent).toContain("Recording");
		await click('[data-quake-sub-touch="meeting-tab-temp"]');
		expect(dom.host.querySelector('[data-animation="recording"]')).toBeNull();
		await click('[data-quake-sub-touch="meeting-tab-live"]');
		expect(animation()).toBeNull();
		await dom.push({ tab: "main", records: [], progress: {} });
		expect(animation()?.getAttribute("data-animation")).toBe("idle");
		expect(animation()?.textContent).toContain("Main meeting is off");
	});

	it("AI-332 panel completion emits 35 bursts, expires at 5s and does not replay on remount", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(epoch);
		window.history.replaceState({}, "", "/?surface=panel");
		const record = complete(101, epoch);
		dom = meetingDom([record]);
		await dom.render(view());
		expect(dom.host.querySelectorAll(".meeting-firework")).toHaveLength(35);
		await advance(2000);
		await dom.render(null);
		await dom.render(view());
		expect(dom.host.querySelectorAll(".meeting-firework")).toHaveLength(0);
		await advance(3000);
		expect(animation()).toBeNull();
		expect(element(".meeting-safe-text").textContent).toBe(record.minutes);
		await dom.push({ records: [complete(101, Date.now())] });
		expect(dom.host.querySelectorAll(".meeting-firework")).toHaveLength(35);
		await advance(4999);
		expect(dom.host.querySelectorAll(".meeting-firework")).toHaveLength(35);
		await advance(1);
		expect(dom.host.querySelectorAll(".meeting-firework")).toHaveLength(0);
	});

	it("AI-332 neither management, temporary records nor failed regeneration celebrates", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(epoch);
		window.history.replaceState({}, "", "/");
		const record = complete(102, epoch);
		dom = meetingDom([record]);
		await dom.render(view());
		expect(dom.host.querySelector(".meeting-fireworks")).toBeNull();
		window.history.replaceState({}, "", "/?surface=panel");
		await dom.push({
			records: [{ ...record, state: "failed", summary: "failed" }],
		});
		expect(dom.host.querySelector(".meeting-fireworks")).toBeNull();
		await dom.push({
			tab: "temp",
			records: [
				record,
				{ ...complete(103, epoch), parentId: Option.some(record.id) },
			],
		});
		expect(dom.host.querySelector(".meeting-fireworks")).toBeNull();
	});

	it("AI-334 scales actual shipped and alternate spans and clears only the selected pane via native subtouch", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(epoch + 10000);
		window.history.replaceState({}, "", "/");
		const main = meetingRecord();
		const side = meetingRecord(2, {
			parentId: Option.some(main.id),
			minutes: "Temporary durable minutes",
		});
		dom = meetingDom([main, side], {
			translations: [
				{ id: "t", speaker: "2", text: "Live content", final: true, at: epoch },
			],
			tab: "main",
		});
		await dom.render(view());
		const props = meetingTile();
		expect(props.tile.cellTheme).toBe("meetingAssistantTheme");
		expect(props.tile.hasTouchableSubElements).toBe(true);
		expect(props.tile.slotRadius).toBe(24);
		expect(props.tile.box).toEqual({ x: 2, y: 2, width: 1196, height: 476 });

		expect(element(".meeting-display-stage").getAttribute("style")).toContain(
			`scale(${Math.min(props.tile.box.width / 1196, props.tile.box.height / 456)})`,
		);
		await dom.render(
			createElement(MeetingDisplay, {
				...props,
				tile: {
					...props.tile,
					box: { ...props.tile.box, width: 716, height: 236 },
				},
			}),
		);
		expect(element(".meeting-display-stage").getAttribute("style")).toContain(
			`scale(${236 / 456})`,
		);
		const clear = async () => {
			await act(async () => {
				element('[data-quake-sub-touch="meeting-clear"]').dispatchEvent(
					new CustomEvent("quake-sub-touch-end", {
						detail: { isEffective: true },
					}),
				);
			});
		};
		await clear();
		expect(dom.host.querySelector(".meeting-safe-text")).toBeNull();
		expect(dom.snapshot().records[0]?.minutes).toBe(main.minutes);
		await click('[data-quake-sub-touch="meeting-tab-temp"]');
		expect(element(".meeting-safe-text").textContent).toBe(side.minutes);
		await clear();
		expect(dom.host.querySelector(".meeting-safe-text")).toBeNull();
		await click('[data-quake-sub-touch="meeting-tab-live"]');
		expect(dom.host.textContent).toContain("Live content");
		await clear();
		expect(dom.request).toHaveBeenLastCalledWith({ _tag: "clear" });
		expect(dom.snapshot().translations).toHaveLength(0);
		expect(dom.snapshot().records.map((r) => r.minutes)).toEqual([
			main.minutes,
			side.minutes,
		]);
	});

	it("MGMT-152 MGMT-360 renders live translated updates and language from authoritative state", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(epoch + 10000);
		dom = meetingDom([], { tab: "live", translating: true });
		await dom.render(view());
		expect(dom.host.textContent).toContain("Waiting for translation");
		await dom.push({
			config: { ...dom.snapshot().config, targetLanguage: "de" },
			translations: [
				{
					id: "live",
					speaker: "",
					text: "Hallo <script>text</script>",
					final: false,
					at: Date.now(),
				},
			],
		});
		expect(element(".meeting-translations p").textContent).toBe(
			"Hallo <script>text</script>",
		);
		expect(dom.host.querySelector("script")).toBeNull();
		await dom.push({
			translations: [
				{
					id: "live",
					speaker: "2",
					text: "Hallo zusammen",
					final: true,
					at: Date.now() + 1000,
				},
			],
		});
		expect(dom.host.querySelectorAll(".meeting-translations p")).toHaveLength(
			1,
		);
		expect(element(".meeting-translations p").getAttribute("data-final")).toBe(
			"true",
		);
		expect(element(".meeting-translations").getAttribute("lang")).toBe("de");
		expect(dom.capture).not.toHaveBeenCalled();
	});
});
