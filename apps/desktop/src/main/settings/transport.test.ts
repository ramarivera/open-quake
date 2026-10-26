import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { LocaleSnapshot } from "../../../../../packages/edge/src/settings/settings-contracts";
import { SettingsStorage } from "../../../../../packages/edge/src/settings/settings-repository";
import { SettingsService } from "../../../../../packages/edge/src/settings/settings-service";
import { LOCALE_CHANGED, LOCALE_REQUEST } from "../../shared/locale";
import { createAppLocaleBridge } from "./preload";
import { decodeLocaleRequest, handleLocaleRequest } from "./rpc";

describe("real encoded settings RPC and preload", () => {
	it("updates both windows with validated snapshots and preserves independent listeners", async () => {
		let saved: unknown;
		const runtime = ManagedRuntime.make(
			SettingsService.Default.pipe(
				Layer.provide(
					Layer.succeed(SettingsStorage, {
						osLocale: "de-DE",
						read: Effect.sync(() => Option.fromNullable(saved)),
						write: (next) =>
							Effect.sync(() => {
								saved = next;
							}),
					}),
				),
			),
		);
		const listeners = new Set<(event: unknown, input: unknown) => void>();
		const ipc = {
			invoke: async (channel: string, input?: unknown) => {
				expect(channel).toBe(LOCALE_REQUEST);
				const message = decodeLocaleRequest(input);
				if (!message) throw new Error("Invalid envelope");
				const result = await runtime.runPromise(handleLocaleRequest(message));
				if (
					message._tag === "Request" &&
					message.tag === "settings.setLocale"
				) {
					const snapshot = await runtime.runPromise(
						SettingsService.use((service) => service.locale()),
					);
					for (const listener of listeners) listener({}, snapshot);
				}
				return result;
			},
			on: (
				channel: string,
				listener: (event: unknown, input: unknown) => void,
			) => {
				expect(channel).toBe(LOCALE_CHANGED);
				listeners.add(listener);
			},
			removeListener: (
				_channel: string,
				listener: (event: unknown, input: unknown) => void,
			) => {
				listeners.delete(listener);
			},
		};
		const management = createAppLocaleBridge(ipc),
			panel = createAppLocaleBridge(ipc);
		const received: LocaleSnapshot[] = [];
		const off = panel.subscribe((snapshot) => received.push(snapshot));
		try {
			expect(await management.read()).toEqual({ locale: "de", revision: 0 });
			expect(await management.set("en")).toEqual({ locale: "en", revision: 1 });
			expect(await panel.read()).toEqual({ locale: "en", revision: 1 });
			expect(received).toEqual([{ locale: "en", revision: 1 }]);
			for (const listener of listeners)
				listener({}, { locale: "unsupported", revision: 2 });
			expect(received).toHaveLength(1);
			off();
			await management.set("de");
			expect(received).toHaveLength(1);
		} finally {
			await management.dispose();
			await panel.dispose();
			await runtime.dispose();
		}
		expect(listeners.size).toBe(0);
	}, 10000);
	it("rejects unsupported method, locale, and extra payload authority before dispatch", () => {
		const base = {
			_tag: "Request",
			id: "1",
			tag: "settings.setLocale",
			payload: { locale: "de" },
			headers: [["traceId", "spoof"]],
		};
		expect(decodeLocaleRequest(base)).toMatchObject({ headers: [] });
		expect(
			decodeLocaleRequest({ ...base, payload: { locale: "xx" } }),
		).toBeUndefined();
		expect(
			decodeLocaleRequest({
				...base,
				payload: { locale: "de", owner: "spoof" },
			}),
		).toBeUndefined();
		expect(
			decodeLocaleRequest({ ...base, tag: "settings.exec" }),
		).toBeUndefined();
	});
});

it("rejects locale reads with a plain catalog error and no private cause", async () => {
	const bridge = createAppLocaleBridge({
		invoke: async (_channel, input) => {
			const request = input as { id: string };
			return {
				_tag: "Exit",
				requestId: request.id,
				exit: {
					_tag: "Failure",
					cause: {
						_tag: "Fail",
						error: {
							_tag: "SettingsReadFailed",
							code: "QUAKE.SETTINGS.READ_FAILED",
							category: "dependency",
							message: "The settings could not be read",
							diagnosticCause: { name: "Error", truncated: true },
						},
					},
				},
			};
		},
		on: () => {},
		removeListener: () => {},
	});
	try {
		const failure: unknown = await bridge
			.read()
			.catch((error: unknown) => error);
		expect(failure).toStrictEqual({
			_tag: "SettingsReadFailed",
			code: "QUAKE.SETTINGS.READ_FAILED",
			message: "The settings could not be read",
		});
		expect(failure).not.toBeInstanceOf(Error);
		expect(Object.getPrototypeOf(failure)).toBe(Object.prototype);
	} finally {
		await bridge.dispose();
	}
});
it("projects locale transport failures without private details", async () => {
	const bridge = createAppLocaleBridge({
		invoke: async () => {
			throw new Error("private transport token");
		},
		on: () => {},
		removeListener: () => {},
	});
	try {
		expect(await bridge.read().catch((error: unknown) => error)).toStrictEqual({
			_tag: "SettingsTransportUnavailable",
			code: "QUAKE.SETTINGS.UNAVAILABLE",
			message: "Settings transport unavailable",
		});
	} finally {
		await bridge.dispose();
	}
});
