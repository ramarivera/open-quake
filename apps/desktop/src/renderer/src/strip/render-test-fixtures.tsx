/// <reference types="vite/client" />
import { SessionId, TurnId } from "@open-quake/edge/chat/contracts";
import { Schema } from "effect";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
	copilotProfile,
	dkClawProfile,
	voiceFixtureEnvelope,
} from "../../../main/test/voice-fixtures";
import { ProfileEnvelope } from "../../../shared/profiles";
import type { VoiceSurfaceEvent } from "../../../shared/voice-surface";
import { stripLayout } from "./geometry";
import {
	previewVoiceContext,
	type StripVoiceContext,
} from "./overlays/voice/voice-context";
import { initialVoiceView } from "./overlays/voice/voice-state";
import { stripPaletteProperties } from "./palette";
import { selectStripPage } from "./selection";
import type { StripTileProps } from "./tileRegistry";
import "./strip.css";

export const sessionId = Schema.decodeUnknownSync(SessionId)(
	"00000000-0000-4000-8000-000000000021",
);
export const turnId = Schema.decodeUnknownSync(TurnId)(
	"00000000-0000-4000-8000-000000000022",
);
export function layoutFor(profile = dkClawProfile) {
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)(
		voiceFixtureEnvelope(profile, "QK"),
	);
	const selected = selectStripPage(envelope, "QK");
	return stripLayout(selected.profile, selected.page);
}
export const clawLayout = layoutFor();
export const copilotLayout = layoutFor(copilotProfile);
export function tileProps(
	type: string,
	voice: Partial<StripVoiceContext> = {},
): StripTileProps {
	const tile = [...clawLayout.tiles, ...copilotLayout.tiles].find(
		(t) => t.type === type,
	);
	if (!tile) throw new Error(`Missing fixture ${type}`);
	return {
		tile,
		context: {
			now: undefined,
			hourFormat: "24h",
			voice: {
				...previewVoiceContext,
				view: initialVoiceView,
				surface: "panel",
				...voice,
			},
		},
	};
}
export async function mount(node: ReactNode) {
	Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
		configurable: true,
		value: true,
	});
	const host = document.createElement("div");
	for (const [name, value] of Object.entries(stripPaletteProperties()))
		host.style.setProperty(name, value);
	Object.assign(host.style, {
		position: "relative",
		width: "1920px",
		height: "480px",
	});
	document.body.append(host);
	const root = createRoot(host);
	const render = async (next: ReactNode) => {
		await act(async () => {
			root.render(next);
		});
	};
	await render(node);
	return {
		host,
		render,
		unmount: async () => {
			await act(async () => {
				root.unmount();
			});
			host.remove();
		},
	};
}
export function element<T extends Element = HTMLElement>(
	selector: string,
	host: ParentNode = document,
): T {
	const found = host.querySelector<T>(selector);
	if (!found) throw new Error(`Missing ${selector}`);
	return found;
}
export async function tap(target: Element, confirmedTap = true) {
	await act(async () => {
		target.dispatchEvent(
			new CustomEvent("quake-sub-touch-start", {
				detail: { phase: "start", y: 0, startY: 0 },
			}),
		);
		target.dispatchEvent(
			new CustomEvent("quake-sub-touch-end", {
				detail: { phase: "end", y: 0, startY: 0, confirmedTap },
			}),
		);
	});
}
export async function click(target: HTMLElement) {
	await act(async () => {
		target.click();
	});
}
export async function type(target: HTMLTextAreaElement, text: string) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set?.call(target, text);
		target.dispatchEvent(new Event("input", { bubbles: true }));
	});
}
export const started = (
	keyCode = "1,5",
	source: "typed" | "voice" = "typed",
): Extract<VoiceSurfaceEvent, { _tag: "TurnStarted" }> => ({
	_tag: "TurnStarted",
	serial: "QK",
	keyCode,
	sessionId,
	turnId,
	prompt: "weather?",
	source,
	agent: { id: "weather", name: "Weather", icon: "0-1" },
});
export const delta = (
	textDelta: string,
	seq = 0,
	keyCode = "1,5",
): VoiceSurfaceEvent => ({
	_tag: "Chunk",
	serial: "QK",
	keyCode,
	chunk: { version: 1, sessionId, turnId, seq, type: "answer", textDelta },
});
