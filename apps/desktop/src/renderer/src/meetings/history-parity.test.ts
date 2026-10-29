// @vitest-environment happy-dom
import { Option } from "effect";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stageLabels } from "./history-presentation";
import { MeetingHistory } from "./MeetingHistory";
import { MeetingTranscript, tooltipBounds } from "./MeetingTranscript";
import {
	click,
	element,
	epoch,
	input,
	meetingDom,
	meetingRecord,
} from "./meeting-test-fixture";

let dom: ReturnType<typeof meetingDom>;
afterEach(async () => {
	await dom?.close();
	vi.useRealTimers();
});
const mount = async (records = [meetingRecord()]) => {
	dom = meetingDom(records);
	await dom.render(createElement(MeetingHistory));
};
const selected = () =>
	element(".meeting-record[aria-current=true]").getAttribute("data-record-id");
const select = (index: number) =>
	click(`[data-record-id="${meetingRecord(index).id}"]`);
const submit = () =>
	act(async () => {
		element(".meeting-title-dialog form").dispatchEvent(
			new Event("submit", { bubbles: true, cancelable: true }),
		);
	});
const fail = {
	_tag: "failure",
	code: "QUAKE.MEETING.STORAGE_FAILED",
	message: "History could not be saved",
};

describe("meeting-ui library", () => {
	it("AI-301 SETTINGS-104 searches Unicode, literal punctuation and formatted time and preserves selection on refresh failure", async () => {
		const record = meetingRecord(1, { title: "Überblick [计划].*" });
		await mount([record, meetingRecord(2, { startedAt: epoch - 86400000 })]);
		for (const query of [
			" ÜBERBLICK ",
			"[计划].*",
			new Date(epoch).toLocaleString(),
		]) {
			await input('[aria-label="Search meetings"]', query);
			expect(dom.host.querySelectorAll(".meeting-record")).toHaveLength(1);
		}
		await input('[aria-label="Search meetings"]', "[.*");
		expect(dom.host.textContent).toContain("No matching meetings");
		await input('[aria-label="Search meetings"]', "");
		await select(2);
		vi.useFakeTimers();
		dom.request.mockResolvedValueOnce(fail);
		await click('[aria-label="Refresh"]');
		expect(element('[aria-label="Refresh"]').getAttribute("aria-busy")).toBe(
			"true",
		);
		expect(selected()).toBe(meetingRecord(2).id);
		expect(element(".meeting-notice").textContent).toBe(fail.message);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(999);
		});
		expect(element<HTMLButtonElement>('[aria-label="Refresh"]').disabled).toBe(
			true,
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
		});
		expect(element<HTMLButtonElement>('[aria-label="Refresh"]').disabled).toBe(
			false,
		);
		expect(selected()).toBe(meetingRecord(2).id);
	});
	it("AI-301 waits for a slow refresh beyond the one second feedback", async () => {
		await mount();
		vi.useFakeTimers();
		let resolve: (value: unknown) => void = () => {};
		dom.request.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		await click('[aria-label="Refresh"]');
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1500);
		});
		expect(element<HTMLButtonElement>('[aria-label="Refresh"]').disabled).toBe(
			true,
		);
		await act(async () => {
			resolve(dom.ready());
		});
		expect(element<HTMLButtonElement>('[aria-label="Refresh"]').disabled).toBe(
			false,
		);
	});
	it("AI-302 sorts by capture time with stable ID ties, auto-selects newest and retains identity on inserts", async () => {
		const older = meetingRecord(9, { startedAt: epoch - 60000 });
		await mount([older, meetingRecord(1), meetingRecord(2)]);
		expect(
			[...dom.host.querySelectorAll(".meeting-record-title")].map(
				(node) => node.textContent,
			),
		).toEqual(["Meeting 2", "Meeting 1", "Meeting 9"]);
		expect(selected()).toBe(meetingRecord(2).id);
		await dom.push({
			records: [
				meetingRecord(3, { startedAt: epoch + 60000 }),
				meetingRecord(2),
				meetingRecord(1),
				older,
			],
		});
		expect(selected()).toBe(meetingRecord(2).id);
		await dom.push({
			records: [
				meetingRecord(4, {
					endedAt: Option.none(),
					transcript: [],
					state: "interrupted",
					audio: "interrupted",
				}),
			],
		});
		expect(element(".meeting-record").textContent).toContain(
			"Unknown duration",
		);
		expect(element(".meeting-record").textContent).toContain("Needs attention");
	});
	it.each(stageLabels.map((label, stage) => ({ label, stage })))(
		"AI-302 SETTINGS-104 renders processing stage $stage",
		async ({ label, stage }) => {
			const record = meetingRecord(1, { state: "processing" });
			await mount([record]);
			await dom.push({ progress: { [record.id]: { stage, status: 1 } } });
			expect(element(".meeting-record").textContent).toContain(
				`Processing · ${label}`,
			);
			await click(".meeting-list-tabs button:first-child");
			expect(dom.host.textContent).toContain("Active meetings");
			expect(dom.host.querySelectorAll(".meeting-record")).toHaveLength(1);
		},
	);
	it.each([
		"recording",
		"recorded",
		"cancelled",
		"failed",
		"interrupted",
		"completed",
	] as const)("AI-302 renders state %s", async (state) => {
		await mount([meetingRecord(1, { state })]);
		expect(
			element(".meeting-record [data-state]").getAttribute("data-state"),
		).toBe(state);
		await click(".meeting-list-tabs button:first-child");
		expect(dom.host.querySelectorAll(".meeting-record")).toHaveLength(
			state === "recording" ? 1 : 0,
		);
	});
	it("CENTER-106 refreshes host reselect, remount, shown and focus while preserving pending title", async () => {
		await mount();
		await click('[aria-label="Edit meeting title"]');
		await input(".meeting-title-dialog input", "Unsaved draft");
		const before = dom.request.mock.calls.length;
		await dom.render(createElement(MeetingHistory, { activation: 1 }));
		expect(dom.request.mock.calls.length).toBeGreaterThan(before);
		await act(async () => {
			window.dispatchEvent(new Event("focus"));
		});
		expect(dom.request).toHaveBeenLastCalledWith({ _tag: "read" });
		const old = dom.ready();
		await dom.push({
			records: [meetingRecord(1, { title: "External change" })],
		});
		await dom.emit(old);
		expect(element<HTMLInputElement>(".meeting-title-dialog input").value).toBe(
			"Unsaved draft",
		);
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
		const calls = dom.request.mock.calls.length;
		await act(async () => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(dom.request.mock.calls.length).toBe(calls + 1);
	});
});

describe("meeting-ui documents and task feedback", () => {
	it("AI-308 SETTINGS-105 renders safe Markdown tables/tasks/autolinks with raw copy and both export targets", async () => {
		const minutes =
			"# Decisions\n\n| Owner | Action |\n| --- | --- |\n| Alex | Ship |\n\n- [x] Complete\n- [ ] Pending\n\nhttps://example.com\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n![tracking](https://example.com/pixel.png)";
		await mount([meetingRecord(1, { minutes, attendeeCount: 4 })]);
		expect(element(".meeting-markdown h1").textContent).toBe("Decisions");
		expect(
			dom.host.querySelectorAll(".meeting-markdown table tbody tr"),
		).toHaveLength(1);
		expect(
			dom.host.querySelectorAll(".meeting-markdown input[type=checkbox]"),
		).toHaveLength(2);
		expect(element<HTMLInputElement>(".meeting-markdown input").checked).toBe(
			true,
		);
		expect(element<HTMLAnchorElement>(".meeting-markdown a").href).toBe(
			"https://example.com/",
		);
		expect(
			dom.host.querySelector(
				".meeting-markdown script, .meeting-markdown img, a[href^='javascript:']",
			),
		).toBeNull();
		expect(element(".meeting-markdown").textContent).toContain(
			"<script>alert(1)</script>",
		);
		expect(element(".meeting-meta").textContent).toContain("4 attendees");
		await click(".meeting-copy");
		expect(dom.clipboard).toHaveBeenLastCalledWith(minutes);
		await click(".meeting-document-actions button:nth-child(2)");
		expect(dom.request).toHaveBeenLastCalledWith({
			_tag: "export",
			id: meetingRecord().id,
			artifact: "summary",
		});
		await click("[role=tab]:nth-child(2)");
		await click(".meeting-document-actions button:nth-child(2)");
		expect(dom.request).toHaveBeenLastCalledWith({
			_tag: "export",
			id: meetingRecord().id,
			artifact: "transcript",
		});
	});
	it("AI-311 SETTINGS-106 inspector views target audio/transcript/summary independently and report missing audio", async () => {
		await mount();
		expect(
			[...dom.host.querySelectorAll(".meeting-task p")].map(
				(node) => node.textContent,
			),
		).toEqual(["Complete", "Complete", "Complete"]);
		await click(".meeting-task:nth-of-type(2) button");
		expect(element("[role=tab][aria-selected=true]").textContent).toBe(
			"Transcript",
		);
		await click(".meeting-task:nth-of-type(3) button");
		expect(element("[role=tab][aria-selected=true]").textContent).toBe(
			"Summary",
		);
		await click(".meeting-task:nth-of-type(1) button");
		expect(dom.request).toHaveBeenLastCalledWith({
			_tag: "reveal",
			id: meetingRecord().id,
		});
		dom.request.mockResolvedValueOnce({
			...fail,
			code: "QUAKE.MEETING.AUDIO_MISSING",
			message: "Audio file not found",
		});
		await click(".meeting-task:nth-of-type(1) button");
		expect(dom.host.textContent).toContain("Audio file not found");
	});
	it.each(["audio", "transcription", "summary"] as const)(
		"AI-311 SETTINGS-106 retries failed %s without capture",
		async (task) => {
			await mount([meetingRecord(1, { state: "failed", [task]: "failed" })]);
			await click('.meeting-task[data-state="failed"] button');
			expect(dom.request).toHaveBeenLastCalledWith({
				_tag: "retry",
				id: meetingRecord().id,
			});
			expect(dom.capture).not.toHaveBeenCalled();
			expect(element(".meeting-inspector").getAttribute("aria-busy")).toBe(
				"true",
			);
			await dom.push({ records: [meetingRecord(1, { processingAttempt: 1 })] });
			expect(dom.host.textContent).toContain("Meeting task completed");
		},
	);
	it("AI-312 SETTINGS-107 retains old summary/template while pending, handles stale pushes then success/failure", async () => {
		await mount();
		const original = meetingRecord();
		await click('input[value="interview"]');
		expect(element(".meeting-generated").textContent).toContain(
			"Project weekly",
		);
		await click(".meeting-inspector > button:last-child");
		expect(dom.host.textContent).toContain("Regenerating with User interview.");
		expect(
			element<HTMLButtonElement>(".meeting-inspector > button:last-child")
				.disabled,
		).toBe(true);
		const stale = dom.ready();
		await dom.push({
			records: [
				{
					...original,
					template: "interview",
					state: "processing",
					summary: "processing",
					processingAttempt: 1,
				},
			],
		});
		await dom.emit(stale);
		expect(element(".meeting-markdown").textContent).toContain("Ship Friday.");
		expect(dom.host.textContent).toContain("Regenerating with User interview.");
		const regenerated = {
			...original,
			template: "interview" as const,
			minutes: "# Interview\nNew summary",
			appliedTemplate: Option.some("interview" as const),
			processingAttempt: 1,
		};
		await dom.push({ records: [regenerated] });
		expect(dom.host.textContent).toContain("Summary regenerated");
		expect(element(".meeting-generated").textContent).toContain(
			"User interview",
		);
		await click(".meeting-inspector > button:last-child");
		await dom.push({
			records: [
				{
					...regenerated,
					state: "failed",
					summary: "failed",
					processingAttempt: 2,
				},
			],
		});
		expect(dom.host.textContent).toContain("Failed to regenerate summary");
		expect(element(".meeting-markdown").textContent).toContain("New summary");
		expect(element(".meeting-generated").textContent).toContain(
			"User interview",
		);
	});
});

describe("meeting-ui title and deletion dialogs", () => {
	it("AI-313 SETTINGS-108 validates live CJK/code-point weights, keeps outside clicks open and retries failed saves", async () => {
		await mount();
		await click('[aria-label="Edit meeting title"]');
		await input(".meeting-title-dialog input", "汉".repeat(51));
		await submit();
		expect(element(".meeting-title-dialog output").textContent).toBe("102/100");
		expect(
			dom.request.mock.calls.filter(([command]) => command._tag === "rename"),
		).toHaveLength(0);
		await click(".meetings-page");
		expect(element(".meeting-title-dialog").hasAttribute("open")).toBe(true);
		await input(".meeting-title-dialog input", "   ");
		await submit();
		expect(dom.host.textContent).toContain(
			"Meeting title cannot be empty. Please re-enter.",
		);
		await input(".meeting-title-dialog input", "汉".repeat(50));
		expect(element(".meeting-title-dialog output").textContent).toBe("100/100");
		dom.request.mockResolvedValueOnce(fail);
		await submit();
		expect(element<HTMLInputElement>(".meeting-title-dialog input").value).toBe(
			"汉".repeat(50),
		);
		expect(dom.host.textContent).toContain("Meeting title update failed");
		await submit();
		expect(dom.host.querySelector(".meeting-title-dialog")).toBeNull();
		expect(dom.host.textContent).toContain(
			"Meeting title updated successfully",
		);
	});
	it.each([
		{ index: 3, neighbour: 2 },
		{ index: 2, neighbour: 1 },
		{ index: 1, neighbour: 2 },
	])(
		"AI-314 SETTINGS-108 deletes $index and selects $neighbour",
		async ({ index, neighbour }) => {
			await mount([meetingRecord(1), meetingRecord(2), meetingRecord(3)]);
			await select(index);
			await click(".meeting-document-actions button:first-child");
			await click(".meeting-dialog button:last-of-type");
			expect(selected()).toBe(meetingRecord(neighbour).id);
		},
	);
	it("AI-314 keeps confirmation and selection on failure and never deletes on cancel", async () => {
		await mount([meetingRecord(1), meetingRecord(2)]);
		await select(1);
		await click(".meeting-document-actions button:first-child");
		await click(".meeting-dialog button:first-of-type");
		expect(
			dom.request.mock.calls.filter(([command]) => command._tag === "delete"),
		).toHaveLength(0);
		await click(".meeting-document-actions button:first-child");
		dom.request.mockResolvedValueOnce(fail);
		await click(".meeting-dialog button:last-of-type");
		expect(element(".meeting-dialog").hasAttribute("open")).toBe(true);
		expect(selected()).toBe(meetingRecord(1).id);
	});
});

it("AI-310 AI-317 renders strictly overlapping words, finite open/sentinel marks, numbered selectable bookmarks and bounded tooltips only on main", async () => {
	const record = meetingRecord(1, {
		minutes: "",
		endedAt: Option.some(epoch + 300),
		marks: [{ startMs: 100, endMs: Option.none() }],
		transcript: [
			{
				id: "words",
				speaker: "1",
				startMs: 0,
				endMs: 300,
				text: "Before marked after",
				words: [
					{ text: "Before", startMs: 0, endMs: 100 },
					{ text: "marked", startMs: 100, endMs: 200 },
					{ text: "after", startMs: 200, endMs: 300 },
				],
			},
		],
	});
	await mount([record]);
	expect(
		[
			...dom.host.querySelectorAll(
				'.meeting-transcript-word[data-marked="true"]',
			),
		].map((word) => word.textContent),
	).toEqual(["marked", "after"]);
	expect(dom.host.querySelectorAll(".meeting-bookmark")).toHaveLength(2);
	await click('[aria-label="Mark 1 begin"]');
	expect(
		element('[aria-label="Mark 1 end"]').getAttribute("aria-pressed"),
	).toBe("true");
	expect(
		dom.host.querySelectorAll('.meeting-transcript-word[data-selected="true"]'),
	).toHaveLength(2);
	await act(async () => {
		element<HTMLButtonElement>('[aria-label="Mark 1 begin"]').focus();
	});
	expect(element('[role="tooltip"]').textContent).toContain("End time : 300ms");
	for (const [left, top] of [
		[0, 0],
		[1200, 900],
		[-400, -500],
	] as const) {
		const bounds = tooltipBounds({ left, top, bottom: top + 20 }, 1280, 960);
		expect(bounds.left).toBeGreaterThanOrEqual(20);
		expect(bounds.left + bounds.width).toBeLessThanOrEqual(1260);
		expect(bounds.top).toBeGreaterThanOrEqual(20);
	}
	await dom.push({ records: [{ ...record, parentId: Option.some(0) }] });
	expect(element(".meeting-record").textContent).toContain(
		"Temporary recording",
	);
	expect(dom.host.querySelector(".meeting-bookmark")).toBeNull();
	expect(dom.host.querySelector('[data-marked="true"]')).toBeNull();
	await dom.render(
		createElement(MeetingTranscript, {
			record: {
				...record,
				marks: [{ startMs: 100, endMs: Option.some(31536000100) }],
			},
			now: epoch + 300,
		}),
	);
	expect(dom.host.textContent).toContain("00:00:00 [ Mark 1 end ]");
});

it("AI-314 AI-317 skips deleted children when selecting the next surviving neighbour", async () => {
	const main = meetingRecord(3);
	await mount([
		main,
		meetingRecord(2, { parentId: Option.some(main.id) }),
		meetingRecord(1),
	]);
	await click(".meeting-document-actions button:first-child");
	await click(".meeting-dialog button:last-of-type");
	expect(selected()).toBe(meetingRecord(1).id);
	expect(dom.host.querySelectorAll(".meeting-record")).toHaveLength(1);
});

it("AI-310 preserves exact paragraph text around timed tokens and falls back for unaligned tokens", async () => {
	const text = "  Hello,  世界!\n  ";
	const segment = {
		id: "punctuation",
		speaker: "1",
		startMs: 0,
		endMs: 1000,
		text,
		words: [
			{ text: " Hello", startMs: 0, endMs: 500 },
			{ text: "世界", startMs: 500, endMs: 1000 },
		],
	};
	await mount([meetingRecord(1, { minutes: "", transcript: [segment] })]);
	const displayed = () =>
		[
			...dom.host.querySelectorAll(
				".meeting-transcript-gap, .meeting-transcript-word",
			),
		]
			.map((node) => node.textContent)
			.join("");
	expect(displayed()).toBe(text);
	expect(dom.host.querySelectorAll(".meeting-transcript-word")).toHaveLength(2);
	await dom.push({
		records: [
			meetingRecord(1, {
				minutes: "",
				transcript: [
					{
						...segment,
						words: [{ text: "different", startMs: 0, endMs: 1000 }],
					},
				],
			}),
		],
	});
	expect(displayed()).toBe(text);
	expect(dom.host.querySelectorAll(".meeting-transcript-word")).toHaveLength(1);
});

for (const [omission, words, startMs, endMs] of [
	[
		"leading",
		[
			{ text: "second", startMs: 100, endMs: 200 },
			{ text: "third", startMs: 200, endMs: 300 },
		],
		0,
		100,
	],
	[
		"middle",
		[
			{ text: "First", startMs: 0, endMs: 100 },
			{ text: "third", startMs: 200, endMs: 300 },
		],
		100,
		200,
	],
	["trailing", [{ text: "First", startMs: 0, endMs: 100 }], 200, 300],
] as const) {
	it(`AI-310 places selectable segment bookmarks for marks over ${omission} untimed text`, async () => {
		const text = "First second third";
		await mount([
			meetingRecord(1, {
				minutes: "",
				endedAt: Option.some(epoch + 300),
				marks: [{ startMs, endMs: Option.some(endMs) }],
				transcript: [
					{
						id: "incomplete",
						speaker: "1",
						startMs: 0,
						endMs: 300,
						text,
						words,
					},
				],
			}),
		]);
		expect(dom.host.querySelectorAll(".meeting-bookmark")).toHaveLength(2);
		expect(
			element(".meeting-transcript-segment").getAttribute("data-marked"),
		).toBe("true");
		expect(
			[
				...dom.host.querySelectorAll(
					".meeting-transcript-gap, .meeting-transcript-word",
				),
			]
				.map((node) => node.textContent)
				.join(""),
		).toBe(text);
		await click('[aria-label="Mark 1 begin"]');
		expect(
			element('[aria-label="Mark 1 end"]').getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			element('.meeting-transcript-word[data-selected="true"]').textContent,
		).toBe(text);
	});
}

for (const operation of ["regenerate", "retry"] as const) {
	for (const beforeAck of [false, true]) {
		it(`AI-312 releases pending ${operation} on async storage failure before processing, beforeAck=${beforeAck}`, async () => {
			const record = meetingRecord(
				1,
				operation === "retry"
					? {
							state: "failed",
							summary: "failed",
							errorCode: Option.some(fail.code),
						}
					: {},
			);
			await mount([record]);
			// A prior identical failure must not terminate the next request.
			await dom.emit(fail);
			let acknowledge: (value: unknown) => void = () => {};
			dom.request.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						acknowledge = resolve;
					}),
			);
			const button =
				operation === "regenerate"
					? ".meeting-inspector > button:last-child"
					: '.meeting-task[data-state="failed"] button';
			await click(button);
			if (beforeAck) await dom.emit(fail);
			await act(async () => {
				acknowledge(dom.ready());
			});
			if (!beforeAck) {
				expect(element(".meeting-inspector").getAttribute("aria-busy")).toBe(
					"true",
				);
				await dom.emit(fail);
			}
			// Successful failure persistence can publish the original attempt and minutes.
			await dom.push({
				records: [
					{ ...record, state: "failed", errorCode: Option.some(fail.code) },
				],
			});
			expect(element(".meeting-inspector").getAttribute("aria-busy")).toBe(
				"false",
			);
			expect(element(".meeting-task-feedback").textContent).toBe(
				operation === "regenerate"
					? "Failed to regenerate summary"
					: "Meeting task failed",
			);
			expect(element<HTMLButtonElement>(button).disabled).toBe(false);
			expect(
				element<HTMLFieldSetElement>(".meeting-template-picker").disabled,
			).toBe(false);
			await click(button);
			expect(element(".meeting-inspector").getAttribute("aria-busy")).toBe(
				"true",
			);
		});
	}
}
