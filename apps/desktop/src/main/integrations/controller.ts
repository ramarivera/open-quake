import { Effect, Schema } from "effect";
import { channelDescriptor } from "../../../../../packages/edge/src/channels/channel-catalog";
import { ChannelService } from "../../../../../packages/edge/src/channels/channel-service";
import {
	InputRejected,
	type IntegrationError,
	IntegrationErrors,
} from "../../../../../packages/edge/src/channels/integration-errors";
import { HomeAssistantService } from "../../../../../packages/edge/src/home-assistant/ha-service";
import { ShortcutService } from "../../../../../packages/edge/src/shortcuts/shortcut-service";
import {
	type IntegrationReply,
	IntegrationRequest,
	type KeyTarget,
} from "../../shared/integrations";
export interface IntegrationControllerPorts {
	readonly openExternal: (url: string) => Promise<void>;
	readonly targets: () => Promise<readonly KeyTarget[]>;
}
export const integrationFailure = (
	error: IntegrationError,
): IntegrationReply => ({
	type: "error",
	code: error.code,
	message: IntegrationErrors[error._tag].message,
	field: error instanceof InputRejected ? error.field : "",
});
export function makeIntegrationController(ports: IntegrationControllerPorts) {
	return Effect.gen(function* () {
		const channels = yield* ChannelService;
		const shortcuts = yield* ShortcutService;
		const ha = yield* HomeAssistantService;
		const open = (url: string) =>
			Effect.tryPromise({
				try: async () => {
					const parsed = new URL(url);
					if (
						parsed.protocol !== "https:" ||
						parsed.username ||
						parsed.password
					)
						throw new InputRejected();
					await ports.openExternal(url);
					return { type: "ok", message: "" } satisfies IntegrationReply;
				},
				catch: (c) => new InputRejected(c, "URL"),
			});
		const dispatch = Effect.fn("Integrations.dispatch")(function* (
			request: IntegrationRequest,
		): Effect.fn.Return<IntegrationReply, IntegrationError> {
			switch (request.type) {
				case "channels.list":
					return { type: "channels", channels: yield* channels.list() };
				case "channels.save":
					return {
						type: "channels",
						channels: yield* channels.save(
							request.id,
							request.fields,
							request.session,
						),
					};
				case "channels.enable":
					return {
						type: "channels",
						channels: yield* channels.setEnabled(request.id, request.enabled),
					};
				case "channels.remove":
					return {
						type: "channels",
						channels: yield* channels.remove(request.id),
					};
				case "channels.portal":
					return yield* open(channelDescriptor(request.id)?.platformUrl ?? "");
				case "channels.qr.start":
					return { type: "qr", session: yield* channels.startQr(request.id) };
				case "channels.qr.read":
					return {
						type: "qr",
						session: yield* channels.readQr(request.session),
					};
				case "channels.qr.open":
					return yield* open((yield* channels.readQr(request.session)).url);
				case "channels.qr.cancel":
					yield* channels.cancelQr(request.session);
					return { type: "ok", message: "" };
				case "channels.pairings":
					return {
						type: "pairings",
						pairings: yield* channels.pairings(request.id),
					};
				case "channels.approve":
					return {
						type: "pairings",
						pairings: yield* channels.approve(request.id, request.code),
					};
				case "shortcuts.list":
					return {
						type: "libraries",
						libraries: yield* shortcuts.list(),
						aiAvailable: shortcuts.available,
					};
				case "shortcuts.generate":
					return {
						type: "draft",
						...(yield* shortcuts.generate(request.app, request.prompt)),
					};
				case "shortcuts.save":
					return {
						type: "libraries",
						libraries: yield* shortcuts.save(request.library),
						aiAvailable: shortcuts.available,
					};
				case "shortcuts.remove":
					return {
						type: "libraries",
						libraries: yield* shortcuts.remove(request.id),
						aiAvailable: shortcuts.available,
					};
				case "shortcuts.sync":
					return { type: "ok", message: yield* shortcuts.sync(request.id) };
				case "ha.read":
					return { type: "ha", snapshot: yield* ha.snapshot() };
				case "ha.connect":
					return {
						type: "ha",
						snapshot: yield* ha.connect(
							request.origin,
							request.token,
							request.allowInsecureHttp,
						),
					};
				case "ha.trust":
					return { type: "ha", snapshot: yield* ha.trust(request.certificate) };
				case "ha.revoke":
					return { type: "ha", snapshot: yield* ha.revoke(request.origin) };
				case "ha.allowlist":
					return { type: "ha", snapshot: yield* ha.allowlist(request.ids) };
				case "ha.key":
					yield* ha.saveKey(request.target, request.key);
					return { type: "ok", message: "Saved" };
				case "ha.targets":
					return {
						type: "targets",
						targets: yield* Effect.tryPromise({
							try: ports.targets,
							catch: (c) => new InputRejected(c, "profile keys"),
						}),
					};
				case "ha.live":
					return { type: "live", live: yield* ha.live() };
			}
		});
		return {
			request: Effect.fn("Integrations.request")(
				(input: unknown): Effect.Effect<IntegrationReply> =>
					Schema.decodeUnknown(IntegrationRequest)(input, {
						onExcessProperty: "error",
					}).pipe(
						Effect.catchTag("ParseError", (c) =>
							Effect.fail(new InputRejected(c)),
						),
						Effect.flatMap(dispatch),
						Effect.match({
							onSuccess: (r) => r,
							onFailure: integrationFailure,
						}),
					),
			),
		};
	});
}
