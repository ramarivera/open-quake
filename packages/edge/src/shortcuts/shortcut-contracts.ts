import { Schema } from "effect";
export const ShortcutRow = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	app: Schema.String,
	chord: Schema.String,
});
export type ShortcutRow = typeof ShortcutRow.Type;
export const ShortcutLibrary = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	app: Schema.String,
	createdAt: Schema.String,
	rows: Schema.Array(ShortcutRow),
});
export type ShortcutLibrary = typeof ShortcutLibrary.Type;
export const ShortcutStore = Schema.Struct({
	version: Schema.Literal(1),
	libraries: Schema.Array(ShortcutLibrary),
});
export const GeneratedConfig = Schema.Struct({
	ConfigTitle: Schema.String,
	ConfigData: Schema.Array(
		Schema.Struct({
			title: Schema.String,
			config: Schema.Struct({
				functionType: Schema.String,
				actions: Schema.Array(Schema.Unknown),
			}),
		}),
	),
});
export const GeneratedAction = Schema.Union(
	Schema.Struct({ type: Schema.Literal("key"), value: Schema.String }),
	Schema.Struct({
		operationName: Schema.Literal("key"),
		operationValue: Schema.String,
	}),
);
export interface DraftResult {
	readonly title: string;
	readonly rows: readonly ShortcutRow[];
	readonly dropped: number;
}
