import { Either, Option, Schema } from "effect";
import {
	KnobJson,
	KnobVoiceActions,
	type KnobVoiceRoute,
} from "./knob-contracts.js";
import { InvalidKnobConfig } from "./knob-errors.js";

export const KnobVoiceMigration = Schema.Struct({
	format: Schema.Literal("open-quake.knob-voice.v1"),
	actions: Schema.Union(KnobVoiceActions, Schema.Tuple()),
	active: Schema.Boolean,
	status: Schema.optionalWith(
		Schema.Literal(
			"ready",
			"needsConfiguration",
			"needsMigration",
			"unsupported",
		),
		{ default: () => "needsConfiguration" },
	),
	original: KnobJson,
	diagnostics: Schema.Array(
		Schema.Literal(
			"unknown-route",
			"unsupported-actions",
			"route-fields-normalized",
		),
	),
});
export type KnobVoiceMigration = typeof KnobVoiceMigration.Type;
export interface KnobVoiceCatalog {
	readonly providers: ReadonlyArray<{
		readonly id: string;
		readonly provider: string;
		readonly modelId: string;
	}>;
	readonly agentIds?: ReadonlyArray<string>;
}
const importedActions = Schema.Array(
	Schema.Struct({ type: Schema.String, value: Schema.String }),
);
export const cloneKnobJson = (value: KnobJson): KnobJson => {
	if (Array.isArray(value)) return value.map(cloneKnobJson);
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key, cloneKnobJson(entry)]),
		);
	}
	return value;
};
export const legacyKnobRoute = (
	resourceId: string,
): Option.Option<Exclude<KnobVoiceRoute, "direct">> => {
	if (resourceId === "1-8" || resourceId === "DKClaw")
		return Option.some("dkclaw");
	return /^1-[0-7]$/.test(resourceId)
		? Option.some("legacyAssistant")
		: Option.none();
};

/** Import only: new assignments require an explicit route. No runtime is enabled here. */
export function migrateKnobVoiceActions(
	input: unknown,
	catalog?: KnobVoiceCatalog,
): Either.Either<KnobVoiceMigration, InvalidKnobConfig> {
	const existing = Schema.decodeUnknownEither(KnobVoiceMigration)(input);
	if (Either.isRight(existing)) return Either.right(existing.right);
	const rawJson = Schema.decodeUnknownEither(KnobJson)(input);
	if (Either.isLeft(rawJson))
		return Either.left(InvalidKnobConfig.fromCause(rawJson.left));
	const original = cloneKnobJson(rawJson.right);
	// Detect duplicate discriminators even when their values or other records are malformed.
	const types = Array.isArray(input)
		? input.flatMap((action: unknown) =>
				typeof action === "object" &&
				action !== null &&
				"type" in action &&
				typeof action.type === "string"
					? [action.type]
					: [],
			)
		: [];
	if (new Set(types).size !== types.length)
		return Either.left(InvalidKnobConfig.fromCause("duplicate-voice-field"));
	const decoded = Schema.decodeUnknownEither(importedActions)(input);
	if (Either.isLeft(decoded))
		return Either.right({
			format: "open-quake.knob-voice.v1",
			active: false,
			status: "unsupported",
			actions: [],
			original,
			diagnostics: ["unsupported-actions"],
		});
	const source = decoded.right;
	const values = new Map(source.map((a) => [a.type, a.value.trim()]));
	const rawRoute = values.get("voiceRoute") ?? "legacyAssistant";
	const route =
		rawRoute === "assistant" || rawRoute === "legacy" || rawRoute === ""
			? "legacyAssistant"
			: rawRoute;
	if (route !== "direct" && route !== "dkclaw" && route !== "legacyAssistant") {
		return Either.right({
			format: "open-quake.knob-voice.v1",
			active: false,
			status: "unsupported",
			actions: [],
			original,
			diagnostics: ["unknown-route"],
		});
	}
	const legacy = values.get("model") ?? "";
	const slash = legacy.indexOf("/");
	const provider = slash < 0 ? "" : legacy.slice(0, slash).trim();
	const model = slash < 0 ? legacy : legacy.slice(slash + 1).trim();
	const field = (type: string, fallback: string): string =>
		values.get(type) || fallback;
	const actions: Array<{ type: string; value: string }> = [
		{ type: "voiceRoute", value: route },
	];
	if (route === "direct")
		actions.push(
			{ type: "directProvider", value: field("directProvider", provider) },
			{ type: "directModel", value: field("directModel", model) },
		);
	if (route === "dkclaw") {
		actions.push({
			type: "agentId",
			value: field(
				"agentId",
				catalog?.agentIds?.length === 1 ? (catalog.agentIds[0] ?? "") : "",
			),
		});
		const ref = field("dkclawModel", legacy);
		if (ref) actions.push({ type: "dkclawModel", value: ref });
	}
	if (route === "legacyAssistant")
		actions.push({ type: "assistant", value: field("assistant", "") });
	if (route === "direct" && catalog) {
		const providerField = actions.find((a) => a.type === "directProvider");
		const modelId = actions.find((a) => a.type === "directModel")?.value ?? "";
		if (providerField) {
			const exact = catalog.providers.filter(
				(p) => p.id === providerField.value && p.modelId === modelId,
			);
			const matches = exact.length
				? exact
				: catalog.providers.filter(
						(p) => p.provider === providerField.value && p.modelId === modelId,
					);
			if (matches.length === 1 && matches[0])
				providerField.value = matches[0].id;
		}
	}
	const canonical = Schema.decodeUnknownEither(KnobVoiceActions)(actions);
	if (Either.isLeft(canonical))
		return Either.left(InvalidKnobConfig.fromCause(canonical.left));
	return Either.right({
		format: "open-quake.knob-voice.v1",
		active: true,
		status:
			route === "legacyAssistant"
				? "needsMigration"
				: route === "direct"
					? actions.every((a) => a.value.length > 0) &&
						(!catalog ||
							catalog.providers.filter(
								(p) =>
									p.id === actions[1]?.value && p.modelId === actions[2]?.value,
							).length === 1)
						? "ready"
						: "needsConfiguration"
					: actions[1]?.value &&
							actions.some(
								(a) => a.type === "dkclawModel" && a.value.length > 0,
							) &&
							(!catalog?.agentIds ||
								catalog.agentIds.includes(actions[1].value))
						? "ready"
						: "needsConfiguration",
		actions: canonical.right,
		original,
		diagnostics:
			JSON.stringify(source) === JSON.stringify(actions)
				? []
				: ["route-fields-normalized"],
	});
}

export function directKnobRouteReferences(
	actions: KnobVoiceActions,
): Option.Option<{ readonly providerId: string; readonly modelId: string }> {
	const value = (type: string) =>
		actions.find((a) => a.type === type)?.value.trim() ?? "";
	const providerId = value("directProvider");
	const modelId = value("directModel");
	return value("voiceRoute") === "direct" && providerId && modelId
		? Option.some({ providerId, modelId })
		: Option.none();
}
