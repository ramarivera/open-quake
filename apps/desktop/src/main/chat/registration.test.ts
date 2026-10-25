import { EventEmitter } from "node:events";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_REQUEST } from "../../shared/chat";
import type { DirectChat } from "./host";
import { registerDirectChat } from "./registration";

const ipc = vi.hoisted(() => ({
	handle:
		vi.fn<
			(
				channel: string,
				handler: (event: IpcMainInvokeEvent, input: unknown) => Promise<void>,
			) => void
		>(),
	removeHandler: vi.fn(),
}));
vi.mock("electron", () => ({ ipcMain: ipc }));
const connections = vi.hoisted(() => ({
	make: vi.fn<
		(
			send: (message: unknown) => void,
		) => Effect.Effect<
			{ write: (input: unknown) => Effect.Effect<void> },
			never,
			import("effect").Scope.Scope
		>
	>(),
}));
vi.mock("./rpc-server", () => ({
	decodeChatRequest: (input: unknown) => input,
	makeDesktopChatConnection: (
		_host: unknown,
		send: (message: unknown) => void,
	) => connections.make(send),
}));
const deferred = () => {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
afterEach(() => vi.clearAllMocks());
function fixture() {
	const renderer = "file:///application/index.html";
	const sender = Object.assign(new EventEmitter(), {
		id: 7,
		mainFrame: { url: renderer },
		isDestroyed: () => false,
		getURL: () => renderer,
		send: vi.fn(),
	});
	const win = {
		isDestroyed: () => false,
		webContents: sender,
	} as unknown as BrowserWindow;
	const runtime = ManagedRuntime.make(Layer.empty);
	const registration = registerDirectChat({
		host: { runtime } as unknown as DirectChat,
		management: () => win,
		panel: () => undefined,
		renderer,
	});
	const handler = ipc.handle.mock.calls.find(
		([name]) => name === CHAT_REQUEST,
	)?.[1];
	if (!handler) throw new Error("Missing chat handler");
	return {
		sender,
		registration,
		request: () =>
			handler(
				{
					sender,
					senderFrame: sender.mainFrame,
				} as unknown as IpcMainInvokeEvent,
				{ _tag: "Ping" },
			),
		navigate: () => {
			sender.emit("did-start-navigation", {}, renderer, false, true);
			sender.mainFrame = { url: renderer };
		},
		close: async () => {
			await registration.dispose();
			await runtime.dispose();
		},
	};
}

describe("chat document scope lifecycle", () => {
	it("revokes old replies immediately and creates a fresh connection while old cancellation is pending", async () => {
		const closing = deferred();
		const sends: ((message: unknown) => void)[] = [];
		const writes: unknown[][] = [];
		connections.make.mockImplementation((send) =>
			Effect.gen(function* () {
				const index = sends.push(send) - 1;
				writes[index] = [];
				yield* Effect.addFinalizer(() =>
					index === 0 ? Effect.promise(() => closing.promise) : Effect.void,
				);
				return {
					write: (input: unknown) =>
						Effect.sync(() => {
							writes[index]?.push(input);
						}),
				};
			}),
		);
		const f = fixture();
		try {
			await f.request();
			f.navigate();
			await f.request();
			expect(connections.make).toHaveBeenCalledTimes(2);
			sends[0]?.("stale");
			sends[1]?.("current");
			expect(f.sender.send.mock.calls).toEqual([["chat:rpc:event", "current"]]);
			expect(writes.map((items) => items.length)).toEqual([1, 1]);
		} finally {
			closing.resolve();
			await f.close();
		}
	});
	it("rejects a request from a document navigated away during asynchronous setup", async () => {
		const setup = deferred();
		let count = 0;
		const finalized: number[] = [],
			written: number[] = [];
		connections.make.mockImplementation(() =>
			Effect.gen(function* () {
				const index = count++;
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						finalized.push(index);
					}),
				);
				if (index === 0) yield* Effect.promise(() => setup.promise);
				return {
					write: () =>
						Effect.sync(() => {
							written.push(index);
						}),
				};
			}),
		);
		const f = fixture();
		try {
			const old = expect(f.request()).rejects.toThrow("CHAT.IPC.UNAUTHORIZED");
			await vi.waitFor(() => expect(count).toBe(1));
			f.navigate();
			await f.request();
			setup.resolve();
			await old;
			expect(written).toEqual([1]);
			expect(finalized).toContain(0);
		} finally {
			setup.resolve();
			await f.close();
		}
	});
	it("preserves the scope for in-page and subframe navigation, then closes it once on destruction", async () => {
		const finalized = vi.fn();
		connections.make.mockImplementation(() =>
			Effect.gen(function* () {
				yield* Effect.addFinalizer(() => Effect.sync(finalized));
				return { write: () => Effect.void };
			}),
		);
		const f = fixture();
		try {
			await f.request();
			f.sender.emit("did-start-navigation", {}, "about:blank", false, false);
			f.sender.emit(
				"did-start-navigation",
				{},
				`${f.sender.getURL()}#section`,
				true,
				true,
			);
			await f.request();
			expect(connections.make).toHaveBeenCalledTimes(1);
			expect(finalized).not.toHaveBeenCalled();
			f.sender.emit("destroyed");
			await vi.waitFor(() => expect(finalized).toHaveBeenCalledTimes(1));
		} finally {
			await f.close();
		}
		expect(finalized).toHaveBeenCalledTimes(1);
		expect(f.sender.listenerCount("did-start-navigation")).toBe(0);
	});
});
