import { Option, Schema } from "effect";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import { builtinProfiles } from "../../../../../../packages/device/src/profiles/profile-catalog";
import {
	defaultMeetingConfig,
	type MeetingCommand,
	MeetingId,
	type MeetingRecord,
	MeetingSnapshot,
	type MeetingsBridge,
} from "../../../shared/meeting-bridge";
import { stripLayout } from "../strip/geometry";
import { previewVoiceContext } from "../strip/overlays/voice/voice-context";
import type { StripTileProps } from "../strip/tileRegistry";

export const epoch = Date.UTC(2026, 9, 26, 12);
export function meetingRecord(
	index = 1,
	patch: Partial<MeetingRecord> = {},
): MeetingRecord {
	return {
		id: MeetingId.make(
			`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
		),
		parentId: Option.none(),
		title: `Meeting ${index}`,
		startedAt: epoch,
		endedAt: Option.some(epoch + 61000),
		state: "completed",
		audio: "complete",
		transcription: "complete",
		summary: "complete",
		marks: [],
		transcript: [
			{
				id: "one",
				speaker: "1",
				startMs: 0,
				endMs: 1000,
				text: "Alex will ship Friday.",
			},
		],
		minutes: "## Decisions\n\nShip **Friday**.\n",
		template: "project-weekly",
		appliedTemplate: Option.some("project-weekly"),
		provenance: Option.none(),
		errorCode: Option.none(),
		config: defaultMeetingConfig,
		...patch,
	};
}
let revision = 0;
export function meetingDom(
	records: readonly MeetingRecord[] = [],
	patch: Partial<MeetingSnapshot> = {},
) {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	revision += 100;
	let snapshot: MeetingSnapshot = {
		revision,
		records,
		config: defaultMeetingConfig,
		mic: Option.some(true),
		cooldowns: {},
		translations: [],
		translating: false,
		tab: "main",
		notice: "",
		mock: true,
		...patch,
	};
	let receive: (value: unknown) => void = () => {};
	const ready = () => ({
		_tag: "ready",
		snapshot: Schema.encodeSync(MeetingSnapshot)(snapshot),
	});
	const request = vi.fn<MeetingsBridge["request"]>(
		async (command: MeetingCommand) => {
			switch (command._tag) {
				case "rename":
					snapshot = {
						...snapshot,
						records: snapshot.records.map((r) =>
							r.id === command.id ? { ...r, title: command.title } : r,
						),
					};
					break;
				case "template":
					snapshot = {
						...snapshot,
						records: snapshot.records.map((r) =>
							r.id === command.id ? { ...r, template: command.template } : r,
						),
					};
					break;
				case "tab":
					snapshot = { ...snapshot, tab: command.tab };
					break;
				case "clear":
					snapshot = { ...snapshot, translations: [] };
					break;
				case "delete":
					snapshot = {
						...snapshot,
						records: snapshot.records.filter(
							(r) =>
								r.id !== command.id && !Option.contains(r.parentId, command.id),
						),
					};
					break;
			}
			snapshot = { ...snapshot, revision: snapshot.revision + 1 };
			return ready();
		},
	);
	const capture = vi.fn();
	const bridge: MeetingsBridge = {
		request,
		onSnapshot: (callback) => {
			receive = callback;
			return () => {
				receive = () => {};
			};
		},
		onCapture: capture,
		captureReply: capture,
		writeChunk: async () => {
			capture();
		},
		pcm: async () => {
			capture();
		},
		sourceLost: capture,
	};
	Object.defineProperty(window, "quakeMeetings", {
		configurable: true,
		value: bridge,
	});
	const clipboard = vi.fn(async (_text: string) => {});
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText: clipboard },
	});
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const render = async (node: ReactNode) => {
		await act(async () => {
			root.render(node);
		});
	};
	return {
		host,
		request,
		clipboard,
		capture,
		render,
		ready,
		snapshot: () => snapshot,
		push: async (patch: Partial<MeetingSnapshot>) => {
			await act(async () => {
				snapshot = { ...snapshot, revision: snapshot.revision + 1, ...patch };
				receive(ready());
			});
		},
		emit: async (value: unknown) => {
			await act(async () => {
				receive(value);
			});
		},
		close: async () => {
			await act(async () => {
				root.unmount();
			});
			host.remove();
			vi.unstubAllGlobals();
		},
	};
}
export const element = <T extends Element = HTMLElement>(
	selector: string,
	root: ParentNode = document,
): T => {
	const found = root.querySelector<T>(selector);
	if (!found) throw new Error(`Missing ${selector}`);
	return found;
};
export const click = async (selector: string, root: ParentNode = document) => {
	await act(async () => {
		element<HTMLButtonElement>(selector, root).click();
	});
};
export const input = async (selector: string, value: string) => {
	await act(async () => {
		const field = element<HTMLInputElement>(selector);
		Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set?.call(field, value);
		field.dispatchEvent(new Event("input", { bubbles: true }));
	});
};
export function meetingTile(
	type = "liveAudioTranslateDisplay",
): StripTileProps {
	const profile = builtinProfiles("darwin").find((p) => p.id === "1-1");
	if (!profile) throw new Error("Missing MeetAI");
	const tile = stripLayout(profile, profile.pages[0]).tiles.find(
		(t) => t.type === type,
	);
	if (!tile) throw new Error(`Missing ${type}`);
	return {
		tile,
		context: { now: undefined, hourFormat: "24h", voice: previewVoiceContext },
	};
}
