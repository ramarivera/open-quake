import { Either, Option, Schema } from "effect";
import {
	DEFAULT_KNOB_TITLE,
	type EmptyKnobSlot,
	KNOB_SLOT_INDEX,
	KnobFunction,
	KnobJson,
	KnobResource,
	type KnobSlot,
	type KnobSlotName,
	type KnobSlots,
} from "./knob-contracts.js";
import { InvalidKnobConfig } from "./knob-errors.js";
import {
	findKnobCapability,
	KNOB_OWNED_CAPABILITIES,
	type KnobRegistry,
} from "./knob-registry.js";
import {
	cloneKnobJson,
	legacyKnobRoute,
	migrateKnobVoiceActions,
} from "./knob-route-invariants.js";

export const emptyKnobSlot = (): typeof EmptyKnobSlot.Type => ({
	childrenName: "",
	config: { type: "", actions: [] },
});
export const emptyKnobResource = (): KnobResource => ({
	keyCode: "0,1",
	config: {
		type: "knob",
		title: { ...DEFAULT_KNOB_TITLE },
		icon: "",
		size: [1, 1],
		display: true,
		subActions: [emptyKnobSlot(), emptyKnobSlot(), emptyKnobSlot()],
	},
});
export const KnobImport = Schema.Struct({
	format: Schema.Literal("open-quake.knob.v1"),
	resource: KnobResource,
	compatibility: Schema.Struct({
		original: KnobJson,
		diagnostics: Schema.Array(
			Schema.Literal(
				"ambiguous-slots",
				"unsupported-slot",
				"unknown-route",
				"normalized-slot",
			),
		),
		inactiveSlots: Schema.Record({ key: Schema.String, value: KnobJson }),
		legacyRouteLock: Schema.optionalWith(
			Schema.Literal("dkclaw", "legacyAssistant"),
			{ as: "Option" },
		),
	}),
});
export type KnobImport = typeof KnobImport.Type;
export interface KnobImportOptions {
	readonly navigationContext?: boolean;
	readonly resourceId?: string;
	readonly registry?: KnobRegistry;
}
type JsonObject = { readonly [key: string]: KnobJson };
const object = (value: KnobJson | undefined): JsonObject =>
	typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as JsonObject)
		: {};
const isHole = (value: KnobJson | undefined): boolean => {
	if (value === null || value === undefined) return true;
	if (typeof value !== "object" || Array.isArray(value)) return false;
	if (Object.keys(value).length === 0) return true;
	const config = object(object(value).config);
	return (
		config.type === "" &&
		Array.isArray(config.actions) &&
		config.actions.length === 0
	);
};
const presetTypes = [
	"assistant",
	"brightness",
	"luminance",
	"homeAssistant",
	"hotkey",
	"media",
	"goToPage",
	"previousPage",
	"nextPage",
	"panelBrightness",
];
const slotNames: ReadonlyArray<KnobSlotName> = ["center", "left", "right"];

/** Strict canonical validation plus the injected function registry. */
export function validateKnobResource(
	input: unknown,
	registry: KnobRegistry = KNOB_OWNED_CAPABILITIES,
): Either.Either<KnobResource, InvalidKnobConfig> {
	const decoded = Schema.decodeUnknownEither(KnobResource, {
		onExcessProperty: "error",
	})(input);
	if (Either.isLeft(decoded))
		return Either.left(InvalidKnobConfig.fromCause(decoded.left));
	for (const slot of decoded.right.config.subActions) {
		if (slot.config.type === "") continue;
		const assignment = Schema.decodeUnknownEither(KnobFunction)(slot);
		if (Either.isLeft(assignment))
			return Either.left(InvalidKnobConfig.fromCause(assignment.left));
		const capability = findKnobCapability(
			registry,
			assignment.right.config.type,
		);
		if (Option.isNone(capability))
			return Either.left(InvalidKnobConfig.fromCause("unregistered-function"));
		const valid = capability.value.validate(assignment.right);
		if (Either.isLeft(valid)) return Either.left(valid.left);
	}
	return Either.right(decoded.right);
}

/** Pure import. Unsupported payloads stay in compatibility and canonical slots stay empty. */
export function migrateKnobResource(
	input: unknown,
	options: KnobImportOptions = {},
): Either.Either<KnobImport, InvalidKnobConfig> {
	const domain = Schema.validateEither(KnobImport)(input);
	if (Either.isRight(domain)) return Either.right(domain.right);
	const existing = Schema.decodeUnknownEither(KnobImport)(input);
	if (Either.isRight(existing)) return Either.right(existing.right);
	const json = Schema.decodeUnknownEither(KnobJson)(input);
	if (Either.isLeft(json))
		return Either.left(InvalidKnobConfig.fromCause(json.left));
	const original = cloneKnobJson(json.right);
	const root = object(original);
	const config = object(root.config);
	const legacyNavigationContainer =
		options.navigationContext &&
		((root.childrenName === "previousPage" && config.type === "pageUp") ||
			(root.childrenName === "nextPage" && config.type === "pageDown"));
	if (
		root.keyCode !== "0,1" ||
		(config.type !== "knob" && !legacyNavigationContainer) ||
		!Array.isArray(config.subActions)
	)
		return Either.left(InvalidKnobConfig.fromCause("knob-identity-or-slots"));
	const source: ReadonlyArray<KnobJson> = config.subActions;
	if (source.length > 3)
		return Either.left(InvalidKnobConfig.fromCause("slot-count"));
	const diagnostics: Array<
		(typeof KnobImport.Type.compatibility.diagnostics)[number]
	> = [];
	const inactiveSlots: Record<string, KnobJson> = {};
	let positioned: Array<KnobJson | undefined> = [
		undefined,
		undefined,
		undefined,
	];
	const tagged = source.some((entry) => typeof object(entry).slot === "string");
	if (tagged) {
		const seen = new Set<string>();
		for (const entry of source) {
			if (isHole(entry)) continue;
			const name = object(entry).slot;
			if (name !== "center" && name !== "left" && name !== "right")
				return Either.left(InvalidKnobConfig.fromCause("slot-metadata"));
			if (seen.has(name))
				return Either.left(InvalidKnobConfig.fromCause("duplicate-slot"));
			seen.add(name);
			positioned[KNOB_SLOT_INDEX[name]] = entry;
		}
	} else if (
		source.length === 3 ||
		source.some(isHole) ||
		source.length === 0
	) {
		positioned = [source[0], source[1], source[2]];
	} else if (
		source.length === 1 &&
		(presetTypes.includes(String(object(object(source[0]).config).type)) ||
			(legacyNavigationContainer &&
				["pageUp", "pageDown"].includes(
					String(object(object(source[0]).config).type),
				)))
	) {
		positioned[0] = source[0];
	} else {
		diagnostics.push("ambiguous-slots");
		inactiveSlots.compact = [...source];
	}
	const registry = options.registry ?? KNOB_OWNED_CAPABILITIES;
	const slots: KnobSlot[] = [];
	for (const [index, raw] of positioned.entries()) {
		const name = slotNames[index];
		if (!name || isHole(raw)) {
			slots.push(emptyKnobSlot());
			continue;
		}
		const entry = object(raw);
		const oldConfig = object(entry.config);
		let type = oldConfig.type;
		if (options.navigationContext && (type === "pageUp" || type === "pageDown"))
			type = type === "pageUp" ? "previousPage" : "nextPage";
		let actions = oldConfig.actions;
		let unknownRoute = false;
		if (type === "assistant") {
			const voice = migrateKnobVoiceActions(actions ?? []);
			if (Either.isLeft(voice)) return Either.left(voice.left);
			actions = [...voice.right.actions];
			unknownRoute = !voice.right.active;
		}
		const candidate = {
			childrenName:
				type === oldConfig.type ? (entry.childrenName ?? type) : type,
			config: {
				type,
				actions: actions ?? [],
				...(oldConfig.title === undefined ? {} : { title: oldConfig.title }),
				...(oldConfig.icon === undefined ? {} : { icon: oldConfig.icon }),
			},
		};
		const decoded = Schema.decodeUnknownEither(KnobFunction)(candidate);
		const capability =
			typeof type === "string"
				? findKnobCapability(registry, type)
				: Option.none();
		const valid =
			Either.isRight(decoded) &&
			Option.isSome(capability) &&
			Either.isRight(capability.value.validate(decoded.right));
		if (!valid || unknownRoute) {
			if (raw !== undefined) inactiveSlots[name] = raw;
			diagnostics.push(unknownRoute ? "unknown-route" : "unsupported-slot");
			slots.push(emptyKnobSlot());
		} else if (Either.isRight(decoded)) {
			slots.push(decoded.right);
			if (JSON.stringify(raw) !== JSON.stringify(decoded.right))
				diagnostics.push("normalized-slot");
		}
	}
	const resource = Schema.decodeUnknownEither(KnobResource)({
		keyCode: "0,1",
		config: {
			type: "knob",
			title: config.title ?? DEFAULT_KNOB_TITLE,
			icon: config.icon ?? "",
			size: config.size ?? [1, 1],
			display: config.display ?? true,
			subActions: slots,
		},
	});
	if (Either.isLeft(resource))
		return Either.left(InvalidKnobConfig.fromCause(resource.left));
	return Either.right({
		format: "open-quake.knob.v1",
		resource: resource.right,
		compatibility: {
			original,
			diagnostics,
			inactiveSlots,
			legacyRouteLock: legacyKnobRoute(options.resourceId ?? ""),
		},
	});
}

/** Profile lane can extract exactly one reserved entry without rewriting other keys. */
export function extractLegacyKnob(
	entries: ReadonlyArray<KnobJson>,
	options: KnobImportOptions = {},
): Either.Either<
	{
		readonly keys: ReadonlyArray<KnobJson>;
		readonly knob: Option.Option<KnobImport>;
	},
	InvalidKnobConfig
> {
	const reserved = entries.filter(
		(entry) =>
			object(entry).keyCode === "0,1" ||
			object(object(entry).config).type === "knob",
	);
	if (reserved.length > 1)
		return Either.left(InvalidKnobConfig.fromCause("duplicate-knob"));
	const first = reserved[0];
	if (first === undefined)
		return Either.right({
			keys: entries.map(cloneKnobJson),
			knob: Option.none(),
		});
	const migrated = migrateKnobResource(first, options);
	return Either.isLeft(migrated)
		? Either.left(migrated.left)
		: Either.right({
				keys: entries.filter((entry) => entry !== first).map(cloneKnobJson),
				knob: Option.some(migrated.right),
			});
}

export const replaceKnobSlot = (
	slots: KnobSlots,
	slot: KnobSlotName,
	value: KnobSlot,
): KnobSlots => [
	slot === "center" ? value : slots[0],
	slot === "left" ? value : slots[1],
	slot === "right" ? value : slots[2],
];
