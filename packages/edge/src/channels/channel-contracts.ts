import { Schema } from "effect";
export const ChannelId = Schema.Literal(
	"feishu",
	"qqbot",
	"openclaw-weixin",
	"wecom",
	"whatsapp",
	"discord",
);
export type ChannelId = typeof ChannelId.Type;
export interface ChannelDescriptor {
	readonly id: ChannelId;
	readonly name: string;
	readonly region: "China" | "International";
	readonly icon: string;
	readonly source: string;
	readonly blurb: string;
	readonly eta: string;
	readonly setupType:
		| "credentials_or_qr"
		| "app_id_secret"
		| "bot_token"
		| "wecom_bot_credentials"
		| "qr_login";
	readonly installSpec: string;
	readonly installSpecFallback?: string;
	readonly bundled: boolean;
	readonly pluginEntryId?: string;
	readonly docsUrl: string;
	readonly platformUrl: string;
	readonly minHostVersion: string;
}
export const ChannelConfig = Schema.Struct({
	id: ChannelId,
	enabled: Schema.Boolean,
	credentialRef: Schema.String,
	publicFields: Schema.Record({ key: Schema.String, value: Schema.String }),
});
export type ChannelConfig = typeof ChannelConfig.Type;
export const ChannelStore = Schema.Struct({
	version: Schema.Literal(1),
	channels: Schema.Array(ChannelConfig),
	pendingCredentialRefs: Schema.optionalWith(Schema.Array(Schema.String), {
		default: () => [],
	}),
});
export const ChannelView = Schema.Struct({
	id: ChannelId,
	enabled: Schema.Boolean,
	configured: Schema.Boolean,
	state: Schema.Literal(
		"Connected",
		"Disabled",
		"Not configured",
		"Configured",
		"Unavailable",
	),
	reason: Schema.String,
	publicFields: Schema.Record({ key: Schema.String, value: Schema.String }),
});
export type ChannelView = typeof ChannelView.Type;
export const QrSession = Schema.Struct({
	id: Schema.String,
	channelId: ChannelId,
	expiresAt: Schema.Number,
	state: Schema.Literal(
		"pending",
		"ready",
		"failed",
		"confirmed",
		"expired",
		"cancelled",
	),
	image: Schema.String,
	url: Schema.String,
	lines: Schema.Array(Schema.String),
});
export type QrSession = typeof QrSession.Type;
export const Pairing = Schema.Struct({
	code: Schema.String,
	sender: Schema.String,
	createdAt: Schema.Number,
});
export type Pairing = typeof Pairing.Type;
export interface JsonStore {
	readonly read: () => Promise<unknown>;
	readonly write: (value: unknown) => Promise<void>;
}
export interface CredentialVault {
	readonly put: (value: string) => Promise<string>;
	readonly get: (reference: string) => Promise<string>;
	readonly remove: (reference: string) => Promise<void>;
}
export interface ChannelRuntime {
	readonly status: () => Promise<{
		readonly available: boolean;
		readonly reason: string;
		readonly connected: readonly ChannelId[];
	}>;
	readonly configure: (
		config: ChannelConfig,
		credentials: Readonly<Record<string, string>>,
	) => Promise<void>;
	readonly remove: (id: ChannelId) => Promise<void>;
	readonly startQr: (
		id: ChannelId,
		session: string,
		receive: (progress: {
			readonly image?: string;
			readonly url?: string;
			readonly lines?: readonly string[];
			readonly confirmed?: boolean;
			readonly failed?: boolean;
			readonly expiresAt?: number;
		}) => void,
	) => Promise<() => void>;
	readonly pairings: (id: ChannelId) => Promise<readonly Pairing[]>;
	readonly approve: (id: ChannelId, code: string) => Promise<void>;
}
