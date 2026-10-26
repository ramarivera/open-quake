import { Schema } from "effect";
export const STRIP_MESSAGE = "quake:strip-message";
export const StripMessage = Schema.Union(
	Schema.Struct({
		type: Schema.Literal("press"),
		keyAction: Schema.Literal(0, 1, 2, 3),
		keyCode: Schema.String.pipe(Schema.pattern(/^[12],[1-8]$/)),
	}),
	Schema.Struct({
		type: Schema.Literal("reportConfig"),
		keyMatrix: Schema.Struct({
			row: Schema.Literal(2),
			col: Schema.Literal(8),
		}),
		appVersion: Schema.String,
	}),
	Schema.Struct({
		type: Schema.Literal("reportActiveProfile"),
		resourceId: Schema.NonEmptyString,
		version: Schema.Int.pipe(Schema.nonNegative()),
	}),
	Schema.Struct({
		type: Schema.Literal("modeSwitch"),
		mode: Schema.Literal("gaming"),
		enable: Schema.Boolean,
	}),
	Schema.Struct({
		type: Schema.Literal("clawBotChatRequest"),
		keyCode: Schema.String.pipe(Schema.pattern(/^[12],[1-8]$/)),
		agentId: Schema.optional(Schema.String),
		data: Schema.Union(
			Schema.Struct({
				action: Schema.Literal("send"),
				type: Schema.Literal("text"),
				content: Schema.String.pipe(
					Schema.minLength(1),
					Schema.maxLength(8000),
				),
			}),
			Schema.Struct({ action: Schema.Literal("stop") }),
		),
	}),
	Schema.Struct({
		type: Schema.Literal("functionKeyPressed"),
		functionName: Schema.Literal("managementCenter"),
		tabType: Schema.optional(
			Schema.Literal("profiles", "keys", "agents", "settings"),
		),
	}),
	Schema.Struct({
		type: Schema.Literal("callback"),
		keyCode: Schema.String.pipe(Schema.pattern(/^[12],[1-8]$/)),
	}),
);
export type StripMessage = typeof StripMessage.Type;
export interface StripTransportBridge {
	send(
		session: string,
		message: StripMessage,
	): Promise<{ readonly ok: boolean }>;
}
declare global {
	interface Window {
		readonly quakeStripTransport?: StripTransportBridge;
	}
}
