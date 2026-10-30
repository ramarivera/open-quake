import { InputRejected } from "../channels/integration-errors.js";
import type { Entity, HaKey, HaService, Json } from "./ha-contracts.js";
export function haOrigin(input: string): string {
	try {
		const url = new URL(input);
		if (
			!["https:", "http:"].includes(url.protocol) ||
			!url.hostname ||
			url.username ||
			url.password
		)
			throw new InputRejected();
		return url.origin;
	} catch (cause) {
		throw new InputRejected(cause, "Server address");
	}
}
export const DEFAULT_AI_DOMAINS = [
	"climate",
	"light",
	"media_player",
	"person",
	"sensor",
	"switch",
	"weather",
];
export const defaultAllowlist = (entities: readonly Entity[]) =>
	entities
		.filter((e) => DEFAULT_AI_DOMAINS.includes(e.entity_id.split(".")[0] ?? ""))
		.map((e) => e.entity_id);
export const groupEntities = (
	entities: readonly Entity[],
	by: "room" | "entity",
): readonly {
	readonly name: string;
	readonly entities: readonly Entity[];
}[] => {
	const groups = new Map<string, Entity[]>();
	for (const entity of entities) {
		const name =
			by === "room" ? entity.area : (entity.entity_id.split(".")[0] ?? "Other");
		groups.set(name, [...(groups.get(name) ?? []), entity]);
	}
	return [...groups]
		.sort(([a], [b]) =>
			a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b),
		)
		.map(([name, items]) => ({ name, entities: items }));
};
export const requiredServiceData = (
	service: HaService,
): Readonly<Record<string, Json>> =>
	Object.fromEntries(
		service.fields
			.filter((f) => f.required)
			.map((f) => [
				f.name,
				f.type === "number"
					? f.min
					: f.type === "boolean"
						? false
						: f.type === "select"
							? (f.options[0] ?? "")
							: "",
			]),
	);
export function validateHaAction(
	key: HaKey,
	entities: readonly Entity[],
	services: readonly HaService[],
): void {
	const entity = entities.find((e) => e.entity_id === key.entity_id);
	const domain = key.entity_id.split(".")[0];
	const service = services.find(
		(s) => s.domain === domain && s.service === key.service,
	);
	if (!entity) throw new InputRejected(undefined, "Select entity");
	if (!service) throw new InputRejected(undefined, "Select action");
	for (const field of service.fields) {
		const value = key.service_data[field.name];
		if (value === undefined) {
			if (field.required) throw new InputRejected(undefined, field.name);
			continue;
		}
		if (
			(field.type === "number" &&
				(typeof value !== "number" ||
					!Number.isFinite(value) ||
					value < field.min ||
					value > field.max)) ||
			(field.type === "boolean" && typeof value !== "boolean") ||
			(field.type === "select" &&
				(typeof value !== "string" || !field.options.includes(value))) ||
			(field.type === "text" && typeof value !== "string") ||
			(field.required && value === "")
		)
			throw new InputRejected(undefined, field.name);
	}
	if (
		Object.keys(key.service_data).some(
			(k) => !service.fields.some((f) => f.name === k),
		)
	)
		throw new InputRejected(undefined, "service_data");
}
export function validateHaKey(
	key: HaKey,
	entities: readonly Entity[],
	services: readonly HaService[],
): void {
	validateHaAction(key, entities, services);
	const entity = entities.find((e) => e.entity_id === key.entity_id);
	const displayable = new Set([
		"state",
		...Object.keys(entity?.attributes ?? {}),
	]);
	if (
		key.custom_display_detail.some((f) => !displayable.has(f.displayItemKey)) ||
		new Set(key.custom_display_detail.map((f) => f.displayItemKey)).size !==
			key.custom_display_detail.length
	)
		throw new InputRejected(undefined, "Display info");
}
export const tileLines = (
	key: HaKey,
	entity: Entity | undefined,
	connected: boolean,
): readonly string[] => {
	if (key.custom_display_type === "icon") return [];
	if (!connected || !entity) return ["unavailable"];
	if (key.custom_display_type === "default") return [entity.state];
	return key.custom_display_detail.map((item) => {
		const value =
			item.displayItemKey === "state"
				? entity.state
				: entity.attributes[item.displayItemKey];
		const text =
			value === undefined
				? "unavailable"
				: typeof value === "object"
					? JSON.stringify(value)
					: String(value);
		return item.displayAlias ? `${item.displayAlias}: ${text}` : text;
	});
};
