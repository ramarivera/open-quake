import { Schema } from "effect";
import {
	ChannelId,
	ChannelView,
	Pairing,
	QrSession,
} from "../../../../packages/edge/src/channels/channel-contracts";
import {
	Certificate,
	HaKey,
	HaLive,
	HaSnapshot,
	HaTarget,
} from "../../../../packages/edge/src/home-assistant/ha-contracts";
import {
	ShortcutLibrary,
	ShortcutRow,
} from "../../../../packages/edge/src/shortcuts/shortcut-contracts";
export const INTEGRATIONS_REQUEST = "integrations:request";
export const INTEGRATIONS_LIVE = "integrations:ha-live";
const text = Schema.String.pipe(Schema.maxLength(20000));
const id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200));
export const IntegrationRequest = Schema.Union(
	Schema.Struct({ type: Schema.Literal("channels.list") }),
	Schema.Struct({
		type: Schema.Literal("channels.save"),
		id: ChannelId,
		fields: Schema.Record({ key: Schema.String, value: text }),
		session: Schema.String,
	}),
	Schema.Struct({
		type: Schema.Literal("channels.enable"),
		id: ChannelId,
		enabled: Schema.Boolean,
	}),
	Schema.Struct({
		type: Schema.Literal(
			"channels.remove",
			"channels.portal",
			"channels.qr.start",
			"channels.pairings",
		),
		id: ChannelId,
	}),
	Schema.Struct({
		type: Schema.Literal(
			"channels.qr.read",
			"channels.qr.cancel",
			"channels.qr.open",
		),
		session: id,
	}),
	Schema.Struct({
		type: Schema.Literal("channels.approve"),
		id: ChannelId,
		code: id,
	}),
	Schema.Struct({ type: Schema.Literal("shortcuts.list") }),
	Schema.Struct({
		type: Schema.Literal("shortcuts.generate"),
		app: Schema.String.pipe(Schema.maxLength(100)),
		prompt: Schema.String.pipe(Schema.maxLength(180)),
	}),
	Schema.Struct({
		type: Schema.Literal("shortcuts.save"),
		library: ShortcutLibrary,
	}),
	Schema.Struct({
		type: Schema.Literal("shortcuts.remove", "shortcuts.sync"),
		id,
	}),
	Schema.Struct({ type: Schema.Literal("ha.read", "ha.targets", "ha.live") }),
	Schema.Struct({
		type: Schema.Literal("ha.connect"),
		origin: text,
		token: text,
		allowInsecureHttp: Schema.optionalWith(Schema.Boolean, {
			default: () => false,
		}),
	}),
	Schema.Struct({ type: Schema.Literal("ha.trust"), certificate: Certificate }),
	Schema.Struct({ type: Schema.Literal("ha.revoke"), origin: text }),
	Schema.Struct({
		type: Schema.Literal("ha.allowlist"),
		ids: Schema.Array(id),
	}),
	Schema.Struct({
		type: Schema.Literal("ha.key"),
		target: HaTarget,
		key: HaKey,
	}),
);
export type IntegrationRequest = typeof IntegrationRequest.Type;
export const KeyTarget = Schema.Struct({
	...HaTarget.fields,
	label: Schema.String,
	key: Schema.Union(Schema.Null, HaKey),
});
export type KeyTarget = typeof KeyTarget.Type;
export const IntegrationReply = Schema.Union(
	Schema.Struct({
		type: Schema.Literal("channels"),
		channels: Schema.Array(ChannelView),
	}),
	Schema.Struct({ type: Schema.Literal("qr"), session: QrSession }),
	Schema.Struct({
		type: Schema.Literal("pairings"),
		pairings: Schema.Array(Pairing),
	}),
	Schema.Struct({
		type: Schema.Literal("libraries"),
		libraries: Schema.Array(ShortcutLibrary),
		aiAvailable: Schema.Boolean,
	}),
	Schema.Struct({
		type: Schema.Literal("draft"),
		title: Schema.String,
		rows: Schema.Array(ShortcutRow),
		dropped: Schema.Number,
	}),
	Schema.Struct({ type: Schema.Literal("ha"), snapshot: HaSnapshot }),
	Schema.Struct({
		type: Schema.Literal("targets"),
		targets: Schema.Array(KeyTarget),
	}),
	Schema.Struct({ type: Schema.Literal("live"), live: HaLive }),
	Schema.Struct({ type: Schema.Literal("ok"), message: Schema.String }),
	Schema.Struct({
		type: Schema.Literal("error"),
		code: Schema.String,
		message: Schema.String,
		field: Schema.String,
	}),
);
export type IntegrationReply = typeof IntegrationReply.Type;
export interface IntegrationsBridge {
	readonly request: (request: IntegrationRequest) => Promise<IntegrationReply>;
	readonly onHaLive: (
		receive: (live: typeof HaLive.Type) => void,
	) => () => void;
}
declare global {
	interface Window {
		readonly quakeIntegrations?: IntegrationsBridge;
	}
}
