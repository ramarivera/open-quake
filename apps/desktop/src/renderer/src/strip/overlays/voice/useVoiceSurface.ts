import { Either, Option, Schema } from "effect";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
	type GridVoiceInput,
	isHoldToTalkKey,
	VoiceSurfaceEvent,
	type VoiceSurfaceReply,
	VoiceSurfaceReply as VoiceSurfaceReplySchema,
	type VoiceSurfaceRequest,
} from "../../../../../shared/voice-surface";
import type { StripLayout, StripTile } from "../../geometry";
import { stripLocale } from "./strings";
import type { StripVoiceContext } from "./voice-context";
import {
	initialVoiceView,
	type KeyInfo,
	nextExpiry,
	reduceVoice,
	type VoiceAction,
	type VoiceView,
} from "./voice-state";

const decodeEvent = Schema.decodeUnknownEither(VoiceSurfaceEvent);
const decodeReply = Schema.decodeUnknownEither(VoiceSurfaceReplySchema);

const actionValue = (
	actions: readonly { readonly type: string; readonly value: unknown }[],
	type: string,
): Option.Option<string> => {
	const value = actions.find((action) => action.type === type)?.value;
	return typeof value === "string" && value.trim() !== ""
		? Option.some(value.trim())
		: Option.none();
};

/** Key type, shown title and clawbot agent for routing (design.md "Tile routing"). */
export function keyInfo(tile: StripTile): KeyInfo {
	const { config } = tile.key;
	return {
		type: tile.type,
		title:
			config.title.display && config.title.text.trim() !== ""
				? Option.some(config.title.text.trim())
				: Option.none(),
		agentId: actionValue(config.actions, "agentId"),
		voiceInput: isHoldToTalkKey(config),
	};
}

/** Assistant selection also works on clawbot keys with voice input disabled. */
export function voiceInputOf(
	tile: StripTile,
	kind: GridVoiceInput["kind"],
): Option.Option<GridVoiceInput> {
	const type = tile.type;
	if (type !== "aiChat" && type !== "clawbot") return Option.none();
	const agentId = actionValue(tile.key.config.actions, "agentId");
	return Option.some({
		keyCode: tile.keyCode,
		kind,
		type,
		voiceInput: isHoldToTalkKey(tile.key.config),
		...Option.match(agentId, {
			onNone: () => ({}),
			onSome: (value) => ({ agentId: value }),
		}),
	});
}

interface Dispatch {
	readonly action: VoiceAction;
	readonly keys: ReadonlyMap<string, KeyInfo>;
	readonly now: number;
}
const reducer = (view: VoiceView, { action, keys, now }: Dispatch): VoiceView =>
	reduceVoice(view, action, keys, now);

/** Subscribes the strip panel to `voice:surface` and keeps its timers. */
export function useVoiceSurface(layout: StripLayout | undefined): {
	readonly view: VoiceView;
	readonly context: Omit<StripVoiceContext, "surface" | "motion" | "wheelOpen">;
	readonly dispatch: (action: VoiceAction) => void;
} {
	const keys = useMemo(
		() =>
			new Map(
				(layout?.tiles ?? []).map((tile) => [tile.keyCode, keyInfo(tile)]),
			),
		[layout],
	);
	const keysRef = useRef(keys);
	keysRef.current = keys;
	const [view, send] = useReducer(reducer, initialVoiceView);
	const dispatch = useCallback(
		(action: VoiceAction) =>
			send({ action, keys: keysRef.current, now: Date.now() }),
		[],
	);
	useEffect(() => {
		const bridge = window.quakeVoice;
		if (!bridge) return;
		return bridge.onEvent((raw) => {
			const decoded = decodeEvent(raw);
			if (Either.isRight(decoded))
				dispatch({ _tag: "event", event: decoded.right });
		});
	}, [dispatch]);
	// "(3S)" → "(2S)" → "(1S)" → closed, one second apart (QSV:2140-2156).
	const countdown = Option.getOrUndefined(view.overlay.countdown);
	useEffect(() => {
		if (!countdown) return;
		const timer = setTimeout(() => dispatch({ _tag: "countdown" }), 1000);
		return () => clearTimeout(timer);
	}, [countdown, dispatch]);
	const expiry = Option.getOrUndefined(nextExpiry(view));
	useEffect(() => {
		if (expiry === undefined) return;
		const timer = setTimeout(
			() => dispatch({ _tag: "expire" }),
			Math.max(0, expiry - Date.now()),
		);
		return () => clearTimeout(timer);
	}, [expiry, dispatch]);
	const request = useCallback(
		async (value: VoiceSurfaceRequest): Promise<VoiceSurfaceReply> => {
			const bridge = window.quakeVoice;
			if (!bridge)
				return { _tag: "rejected", code: "VOICE.SURFACE.BRIDGE_MISSING" };
			const reply = decodeReply(await bridge.request(value));
			return Either.isRight(reply)
				? reply.right
				: { _tag: "rejected", code: "VOICE.SURFACE.REQUEST_INVALID" };
		},
		[],
	);
	const context = useMemo(
		() => ({
			view,
			locale: stripLocale(navigator.language),
			request,
			toast: (key: Parameters<StripVoiceContext["toast"]>[0]) =>
				dispatch({ _tag: "toast", key }),
		}),
		[view, request, dispatch],
	);
	return { view, context, dispatch };
}
