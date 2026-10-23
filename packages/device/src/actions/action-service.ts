import { Effect, Either, Layer, Option, Ref, Schema } from "effect";
import { ActionHostAdapters, ActionProfileSource } from "./action-adapters.js";
import {
	ActionActivation,
	type CommittedActionSnapshot,
	MediaCommand,
} from "./action-contracts.js";
import {
	type ActionError,
	InvalidKeyAction,
	KeyFunctionUnavailable,
} from "./action-errors.js";
import { validateAction } from "./action-invariants.js";
import { type ActionConfig, findAction } from "./action-registry.js";

export const NoActionHostAdapters = Layer.succeed(ActionHostAdapters, {
	keyboard: Option.none(),
	text: Option.none(),
	website: Option.none(),
	application: Option.none(),
	media: Option.none(),
});
export const NoActionProfileSource = Layer.succeed(ActionProfileSource, {
	readCommitted: () => Effect.succeed(Option.none()),
});
export type ActionDispatchResult = "executed" | "ignored";
interface InputState {
	readonly sessionId: string;
	readonly sequence: number;
	readonly held: boolean;
}
const missing = () => new KeyFunctionUnavailable("adapter-missing");

/** Host leaf execution only. Knob directional actions and view runtimes own their dispatch. */
const execute = Effect.fn("ActionService.execute")(function* (
	config: ActionConfig,
	adapters: ActionHostAdapters["Type"],
): Effect.fn.Return<void, ActionError> {
	switch (findAction(config.type)?.binding) {
		case "website": {
			if (config.type !== "website")
				return yield* Effect.fail(new InvalidKeyAction("config.type"));
			if (Option.isNone(adapters.website)) return yield* Effect.fail(missing());
			return yield* adapters.website.value.openUrl(config.actions[0].value);
		}
		case "hotkey": {
			if (config.type !== "hotkey")
				return yield* Effect.fail(new InvalidKeyAction("config.type"));
			if (config.supportKnob)
				return yield* Effect.fail(new KeyFunctionUnavailable("knob-routing"));
			if (Option.isNone(adapters.keyboard))
				return yield* Effect.fail(missing());
			const chord = config.actions[0].value;
			if (
				!chord
					.split("+")
					.every(
						(key) =>
							Option.isSome(adapters.keyboard) &&
							adapters.keyboard.value.supportedTokens.has(key),
					)
			)
				return yield* Effect.fail(
					new KeyFunctionUnavailable("unsupported-token"),
				);
			return yield* adapters.keyboard.value.pressChord(chord);
		}
		case "text": {
			if (config.type !== "text")
				return yield* Effect.fail(new InvalidKeyAction("config.type"));
			if (Option.isNone(adapters.text)) return yield* Effect.fail(missing());
			// Check both capabilities before the first side effect.
			if (
				config.actions.length === 2 &&
				(Option.isNone(adapters.keyboard) ||
					!adapters.keyboard.value.supportedTokens.has("enter"))
			)
				return yield* Effect.fail(missing());
			yield* adapters.text.value.insertText(config.actions[0].value);
			if (config.actions.length === 2 && Option.isSome(adapters.keyboard))
				yield* adapters.keyboard.value.pressChord("enter");
			return;
		}
		case "open": {
			if (config.type !== "open")
				return yield* Effect.fail(new InvalidKeyAction("config.type"));
			if (Option.isNone(adapters.application))
				return yield* Effect.fail(missing());
			return yield* adapters.application.value.launchApplication(
				config.actions[0].value,
			);
		}
		case "media": {
			const decoded = Schema.decodeUnknownEither(
				Schema.Struct({ type: Schema.Literal("key"), value: MediaCommand }),
			)("actions" in config ? config.actions[0] : undefined);
			if (Either.isLeft(decoded))
				return yield* Effect.fail(
					new InvalidKeyAction("config.actions", decoded.left),
				);
			const command = decoded.right.value;
			if (Option.isNone(adapters.media)) return yield* Effect.fail(missing());
			if (!adapters.media.value.supportedCommands.has(command))
				return yield* Effect.fail(
					new KeyFunctionUnavailable("unsupported-command"),
				);
			return yield* adapters.media.value.sendMedia(command);
		}
		default:
			return yield* Effect.fail(new KeyFunctionUnavailable("owning-runtime"));
	}
});

const matches = (
	event: ActionActivation,
	snapshot: CommittedActionSnapshot,
): boolean =>
	event.deviceId === snapshot.deviceId &&
	event.sessionId === snapshot.sessionId &&
	event.profileId === snapshot.profileId &&
	event.pageId === snapshot.pageId &&
	event.revision === snapshot.revision;

export class ActionService extends Effect.Service<ActionService>()(
	"@open-quake/device/ActionService",
	{
		accessors: true,
		dependencies: [NoActionHostAdapters, NoActionProfileSource],
		effect: Effect.gen(function* () {
			const adapters = yield* ActionHostAdapters;
			const profiles = yield* ActionProfileSource;
			const inputs = yield* Ref.make<ReadonlyMap<string, InputState>>(
				new Map(),
			);
			const activate = Effect.fn("ActionService.activate")(function* (
				input: unknown,
			): Effect.fn.Return<ActionDispatchResult, ActionError> {
				const decoded = Schema.decodeUnknownEither(ActionActivation)(input);
				if (Either.isLeft(decoded))
					return yield* Effect.fail(
						new InvalidKeyAction("activation", decoded.left),
					);
				const event = decoded.right;
				const committed = yield* profiles.readCommitted(event.deviceId);
				if (
					Option.isNone(committed) ||
					committed.value.deviceId !== event.deviceId ||
					committed.value.sessionId !== event.sessionId ||
					(!matches(event, committed.value) && event.kind !== "release")
				)
					return "ignored";
				const key = committed.value.keys.find(
					(key) => key.keyCode === event.keyCode && key.display,
				);
				if (!key && event.kind !== "release") return "ignored";
				const accepted = yield* Ref.modify(
					inputs,
					(current): readonly [boolean, ReadonlyMap<string, InputState>] => {
						const identity = JSON.stringify([event.deviceId, event.keyCode]);
						const previous = current.get(identity);
						const sameSession = previous?.sessionId === event.sessionId;
						if (event.kind === "release" && !sameSession)
							return [false, current];
						if (sameSession && event.sequence <= previous.sequence)
							return [false, current];
						const held = sameSession && previous.held;
						const next = new Map(current);
						next.set(identity, {
							sessionId: event.sessionId,
							sequence: event.sequence,
							held: event.kind !== "release",
						});
						return [event.kind === "press" && !held, next];
					},
				);
				if (!accepted) return "ignored";
				if (!key) return "ignored";
				const action = validateAction(key.childrenName, key.config);
				if (Either.isLeft(action)) return yield* Effect.fail(action.left);
				yield* execute(action.right, adapters);
				return "executed";
			});
			return { activate };
		}),
	},
) {}
