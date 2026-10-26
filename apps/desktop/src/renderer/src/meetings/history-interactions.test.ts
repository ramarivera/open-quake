// @vitest-environment happy-dom
import { Option } from "effect";
import { act, createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { MeetingHistory } from "./MeetingHistory";
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
});
const mount = async (records: Parameters<typeof meetingDom>[0] = []) => {
	dom = meetingDom(records);
	await dom.render(createElement(MeetingHistory));
};
const body = () => element('[role="tabpanel"]');

describe("meeting history consumers", () => {
	it("AI-300 AI-303 switches records/progress, preserves selection and transitions all empty states", async () => {
		await mount();
		expect(element(".meeting-list").textContent).toContain(
			"No meeting minutes records",
		);
		expect(dom.host.textContent).toContain("Select Meeting Minutes");
		expect(dom.host.textContent).toContain(
			"Select a meeting minutes from the left list to view detailed content",
		);
		const records = [
			meetingRecord(1, { state: "recorded" }),
			meetingRecord(2, { state: "recording", endedAt: Option.none() }),
			meetingRecord(3, { state: "processing" }),
			meetingRecord(4),
			meetingRecord(5, { state: "failed" }),
		];
		await dom.push({ records });
		expect(
			element(".meeting-list-tabs button:nth-child(2)").getAttribute(
				"aria-pressed",
			),
		).toBe("true");
		expect(dom.host.querySelectorAll(".meeting-record")).toHaveLength(5);
		await click(".meeting-record:nth-of-type(3)");
		await click(".meeting-list-tabs button:first-child");
		expect(
			[...dom.host.querySelectorAll(".meeting-record-title")].map(
				(e) => e.textContent,
			),
		).toEqual(["Meeting 2", "Meeting 3"]);
		expect(element(".meeting-record[aria-current=true]").textContent).toContain(
			"Meeting 3",
		);
		await click(".meeting-list-tabs button:nth-child(2)");
		expect(element(".meeting-record[aria-current=true]").textContent).toContain(
			"Meeting 3",
		);
		await input('[aria-label="Search meetings"]', "not found");
		expect(element(".meeting-list").textContent).toContain(
			"No matching meetings",
		);
		expect(dom.host.querySelector(".meeting-document")).toBeNull();
		await input('[aria-label="Search meetings"]', "");
		await click(".meeting-list-tabs button:first-child");
		await dom.push({ records: [meetingRecord(4)] });
		expect(element(".meeting-list").textContent).toContain(
			"No meeting minutes records",
		);
		await click(".meeting-list-tabs button:nth-child(2)");
		expect(element(".meeting-document h2").textContent).toContain("Meeting 4");
	});

	it("AI-296 AI-304 edits/saves/cancels titles and confirms deletion through the bridge", async () => {
		const record = meetingRecord();
		await mount([record]);
		expect(element(".meeting-meta").textContent).toBe(
			`${new Date(epoch).toLocaleString()} · 00:01:01 · Attendees not recorded`,
		);
		expect(
			[...dom.host.querySelectorAll(".meeting-document-actions button")].map(
				(e) => e.textContent,
			),
		).toEqual(["Delete", "Export"]);
		await click('[aria-label="Edit meeting title"]');
		await input(".meeting-document header input", "  Renamed meeting  ");
		await act(async () => {
			element("header form").dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});
		expect(dom.request).toHaveBeenCalledWith({
			_tag: "rename",
			id: record.id,
			title: "Renamed meeting",
		});
		expect(element(".meeting-document h2").textContent).toContain(
			"Renamed meeting",
		);
		await click('[aria-label="Edit meeting title"]');
		await input(".meeting-document header input", "Discard me");
		await click(".meeting-document header form button[type=button]");
		expect(
			dom.request.mock.calls.filter(([c]) => c._tag === "rename"),
		).toHaveLength(1);
		expect(element(".meeting-document h2").textContent).toContain(
			"Renamed meeting",
		);
		await click(".meeting-document-actions button:first-child");
		expect(element("dialog").hasAttribute("open")).toBe(true);
		await click("dialog button:first-of-type");
		expect(
			dom.request.mock.calls.filter(([c]) => c._tag === "delete"),
		).toHaveLength(0);
		await click(".meeting-document-actions button:first-child");
		await click("dialog button:last-of-type");
		expect(dom.request).toHaveBeenCalledWith({
			_tag: "delete",
			id: record.id,
			confirmed: true,
		});
		expect(dom.host.textContent).toContain("Select Meeting Minutes");
	});

	it("AI-305 AI-306 copies the exact active body and reports empty or denied clipboard", async () => {
		const record = meetingRecord();
		await mount([record]);
		expect(element("[role=tab][aria-selected=true]").textContent).toBe(
			"Summary",
		);
		expect(element(".meeting-document-body pre").textContent).toBe(
			record.minutes,
		);
		await click(".meeting-copy");
		expect(dom.clipboard).toHaveBeenLastCalledWith(
			"## Decisions\n\nShip **Friday**.\n",
		);
		expect(dom.host.textContent).toContain(
			"Meeting minutes content copied to clipboard",
		);
		await click("[role=tab]:nth-child(2)");
		expect(body().textContent).toContain("Alex will ship Friday.");
		expect(body().textContent).not.toContain("Ship **Friday**");
		await click(".meeting-copy");
		expect(dom.clipboard).toHaveBeenLastCalledWith(
			"00:00:00  Speaker 1\nAlex will ship Friday.",
		);
		expect(dom.host.textContent).toContain(
			"Meeting transcription content copied to clipboard",
		);
		dom.clipboard.mockRejectedValueOnce(new Error("permission denied"));
		await click(".meeting-copy");
		expect(dom.host.textContent).toContain("Copy failed, please copy manually");
		await dom.push({
			records: [meetingRecord(2, { transcript: [], minutes: "" })],
		});
		expect(element<HTMLButtonElement>("[role=tab]:nth-child(2)").disabled).toBe(
			true,
		);
		await click("[role=tab]:first-child");
		const copies = dom.clipboard.mock.calls.length;
		await click(".meeting-copy");
		expect(dom.clipboard).toHaveBeenCalledTimes(copies);
		expect(dom.host.textContent).toContain("No content to copy");
	});

	it("AI-305 AI-307 keeps transcript-only/failed content and dispatches summary-only Retry", async () => {
		const record = meetingRecord(1, {
			minutes: "",
			state: "failed",
			summary: "failed",
		});
		await mount([record]);
		expect(element("[role=tab][aria-selected=true]").textContent).toBe(
			"Transcript",
		);
		expect(body().textContent).toContain("Alex will ship Friday.");
		expect(dom.host.textContent).toContain("Processing failed");
		expect(dom.host.textContent).toContain(
			"Retry the failed task independently without affecting completed audio or transcript tasks.",
		);
		expect(
			[...dom.host.querySelectorAll(".meeting-task p")].map(
				(e) => e.textContent,
			),
		).toEqual(["Complete", "Complete", "Needs attention"]);
		await click(".meeting-processing button");
		expect(dom.request).toHaveBeenLastCalledWith({
			_tag: "retry",
			id: record.id,
		});
		expect(dom.capture).not.toHaveBeenCalled();
		await dom.push({
			records: [{ ...record, state: "processing", summary: "processing" }],
		});
		expect(dom.host.textContent).toContain("Processing, please wait...");
		expect(dom.host.textContent).toContain(
			"Tasks run independently. See current status on the right.",
		);
		expect(body().textContent).toContain("Alex will ship Friday.");
		await click("[role=tab]:first-child");
		expect(body().textContent).toContain("No meeting minutes content");
		expect(body().textContent).toContain(
			"Check task health or regenerate the summary.",
		);
	});

	it("AI-309 renders ordered timestamps, empty speakers and plain markup as escaped text", async () => {
		const record = meetingRecord(1, {
			minutes: "",
			transcript: [
				{
					id: "a",
					speaker: "",
					startMs: 0,
					endMs: 1000,
					text: "Plain transcript fallback",
				},
				{
					id: "b",
					speaker: "<img src=x onerror=alert(1)>",
					startMs: 3661000,
					endMs: 3662000,
					text: "<script>bad()</script> & **raw**",
				},
			],
		});
		await mount([record]);
		expect(
			[...dom.host.querySelectorAll(".meeting-transcript-segment time")].map(
				(e) => e.textContent,
			),
		).toEqual(["00:00:00", "01:01:01"]);
		expect(
			[...dom.host.querySelectorAll(".meeting-transcript-segment strong")].map(
				(e) => e.textContent,
			),
		).toEqual(["Speaker ", "Speaker <img src=x onerror=alert(1)>"]);
		expect(body().textContent).toContain("<script>bad()</script> & **raw**");
		expect(body().querySelector("script, img, b")).toBeNull();
		const reply = dom.ready();
		await dom.emit({
			...reply,
			snapshot: {
				...reply.snapshot,
				records: [
					{
						...reply.snapshot.records[0],
						transcript: [
							{ id: "bad", speaker: 42, startMs: 0, endMs: 1, text: "invalid" },
						],
					},
				],
			},
		});
		expect(element(".meeting-notice").textContent).toBe(
			"Meeting response was invalid",
		);
		expect(body().textContent).toContain("Plain transcript fallback");
	});

	it("AI-316 retains selection/newest state through stale pushes and permits saving after a failed request", async () => {
		const record = meetingRecord(2);
		await mount([meetingRecord(), record]);
		await click(".meeting-record:nth-of-type(2)");
		const old = dom.ready();
		await dom.push({
			records: [
				meetingRecord(3),
				{ ...record, title: "Newest selected title" },
				meetingRecord(),
			],
		});
		await dom.emit(old);
		expect(element(".meeting-record[aria-current=true]").textContent).toContain(
			"Newest selected title",
		);
		expect(element(".meeting-document h2").textContent).toContain(
			"Newest selected title",
		);
		const beforeRename = dom.ready();
		dom.request.mockResolvedValueOnce({
			_tag: "failure",
			code: "QUAKE.MEETING.STORAGE_FAILED",
			message: "History could not be saved",
		});
		await click('[aria-label="Edit meeting title"]');
		await input(".meeting-document header input", "Recovered save");
		const submit = async () => {
			await act(async () => {
				element("header form").dispatchEvent(
					new Event("submit", { bubbles: true, cancelable: true }),
				);
			});
		};
		await submit();
		expect(element(".meeting-notice").textContent).toBe(
			"History could not be saved",
		);
		expect(dom.host.querySelector("header form")).not.toBeNull();
		await submit();
		expect(dom.host.querySelector("header form")).toBeNull();
		expect(element(".meeting-document h2").textContent).toContain(
			"Recovered save",
		);
		await dom.emit(beforeRename);
		expect(element(".meeting-document h2").textContent).toContain(
			"Recovered save",
		);
		expect(element(".meeting-notice").textContent).not.toContain(
			"History could not be saved",
		);
	});
});

it("AI-275 AI-296 template selection preserves the applied summary until regenerate", async () => {
	const record = meetingRecord();
	await mount([record]);
	expect(
		[...dom.host.querySelectorAll(".meeting-template-picker strong")].map(
			(e) => e.textContent,
		),
	).toEqual([
		"Project weekly",
		"Standard minutes",
		"Executive decision brief",
		"User interview",
	]);
	await click('input[value="interview"]');
	expect(dom.request).toHaveBeenLastCalledWith({
		_tag: "template",
		id: record.id,
		template: "interview",
	});
	expect(element<HTMLInputElement>('input[value="interview"]').checked).toBe(
		true,
	);
	expect(body().textContent).toContain("Current template: Project weekly");
	expect(element("pre").textContent).toBe(record.minutes);
	await click(".meeting-inspector > button:last-child");
	expect(dom.request).toHaveBeenLastCalledWith({
		_tag: "regenerate",
		id: record.id,
		template: "interview",
	});
});

it("CENTER-009 refreshes an already-mounted Meetings page on each activation and retains current document", async () => {
	await mount([meetingRecord()]);
	const before = dom.request.mock.calls.filter(
		([c]) => c._tag === "read",
	).length;
	const next = {
		...dom.ready(),
		snapshot: {
			...dom.ready().snapshot,
			revision: dom.ready().snapshot.revision + 1,
			records: [
				{
					...dom.ready().snapshot.records[0],
					title: "Changed outside the page",
				},
			],
		},
	};
	dom.request.mockResolvedValueOnce(next);
	await dom.render(createElement(MeetingHistory, { activation: 1 }));
	expect(
		dom.request.mock.calls.filter(([c]) => c._tag === "read"),
	).toHaveLength(before + 1);
	expect(element(".meeting-document h2").textContent).toContain(
		"Changed outside the page",
	);
	dom.request.mockResolvedValueOnce({
		...next,
		snapshot: { ...next.snapshot, revision: next.snapshot.revision + 1 },
	});
	await dom.render(createElement(MeetingHistory, { activation: 2 }));
	expect(
		dom.request.mock.calls.filter(([c]) => c._tag === "read"),
	).toHaveLength(before + 2);
	expect(element(".meeting-document h2").textContent).toContain(
		"Changed outside the page",
	);
});
