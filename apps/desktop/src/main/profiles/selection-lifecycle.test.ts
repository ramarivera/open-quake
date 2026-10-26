import {
	Effect,
	Fiber,
	Logger,
	Option,
	Schema,
	TestClock,
	TestContext,
} from "effect";
import { BrowserWindow } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { KeyRuntime } from "../../../../../packages/device/src/actions/key-runtime-service";
import {
	createEmptyProfileKey,
	encodeProfileEnvelope,
	ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import { KEY_REQUEST } from "../../shared/key-library";
import { registerProfiles } from "./index";

const storage = vi.hoisted(() => ({
	read: vi.fn<() => Promise<unknown>>(),
	write: vi.fn<(value: unknown, guard?: () => void) => Promise<void>>(),
	recoveries: [],
}));
vi.mock("./local-profile-storage", () => ({
	createDesktopProfileStorage: () => storage,
}));
vi.mock("./profile-ipc", async (load) => ({
	...(await load<typeof import("./profile-ipc")>()),
	registerProfiles: () => ({ dispose: async () => {} }),
}));
const electron = vi.hoisted(() => {
	const frame = { url: "file:///application/index.html" };
	const sender = {
		id: 1,
		on: vi.fn(),
		once: vi.fn(),
		removeListener: vi.fn(),
		mainFrame: frame,
		isDestroyed: () => false,
		getURL: () => frame.url,
		send: vi.fn(),
	};
	return {
		sender,
		app: { getPath: () => "/nonexistent/selection-lifecycle-test" },
		BrowserWindow: class {
			webContents = sender;
			isDestroyed = () => false;
			static getAllWindows: () => never[] = () => [];
			static fromWebContents: () => boolean = () => true;
		},
		ipcMain: {
			handle:
				vi.fn<
					(
						channel: string,
						handler: (
							event: { sender: typeof sender; senderFrame: typeof frame },
							input: unknown,
						) => Promise<unknown>,
					) => void
				>(),
			removeHandler: vi.fn(),
		},
	};
});
vi.mock("electron", () => electron);
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
	vi.stubEnv("OPEN_QUAKE_MOCK_DEVICE", "1");
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
		schemaVersion: 1,
		profiles: ["a", "b"].map((id) => ({
			id,
			name: id,
			revision: 0,
			pages: ["1", "2"].map((page) => ({
				id: page,
				keys: [Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"))],
			})),
		})),
		activeByDevice: {},
	});
	let saved = encodeProfileEnvelope(envelope);
	storage.read.mockImplementation(async () => saved);
	storage.write.mockImplementation(async (value, guard) => {
		guard?.();
		// Keep the committed fixture detached, just like the disk adapter.
		saved = JSON.parse(JSON.stringify(value));
	});
	const reset = vi.fn(async (_serial?: string) => {});
	const deliver = vi.fn(async (_serial: string) => {});
	const management = new BrowserWindow();
	const profiles = registerProfiles(
		() => management,
		electron.sender.getURL(),
		deliver,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		reset,
	);
	await profiles.connect("A", "a");
	await profiles.connect("B", "a");
	reset.mockClear();
	deliver.mockClear();
	const selection = async () =>
		(await profiles.runtime.runPromise(ProfileService.loadProfiles())).envelope
			.activeByDevice.A;
	return { profiles, reset, deliver, selection };
}

it("invalidates only the selected device after key-library and KeyRuntime profile/page commits", async () => {
	const f = await fixture();
	try {
		const handler = electron.ipcMain.handle.mock.calls.find(
			([name]) => name === KEY_REQUEST,
		)?.[1];
		if (!handler) throw new Error("Missing key-library handler");
		expect(
			await handler(
				{ sender: electron.sender, senderFrame: electron.sender.mainFrame },
				{
					type: "select",
					deviceId: "A",
					profileId: "b",
					pageId: "1",
				},
			),
		).toMatchObject({ _tag: "success" });
		expect(f.reset.mock.calls).toEqual([["A"]]);
		await f.profiles.runtime.runPromise(KeyRuntime.navigate("A", 1));
		expect(await f.selection()).toEqual({ profileId: "b", pageId: "2" });
		expect(f.reset.mock.calls).toEqual([["A"], ["A"]]);
		await f.profiles.runtime.runPromise(KeyRuntime.navigate("A", 1, 2));
		expect(f.reset).toHaveBeenCalledTimes(2);
		await f.profiles.runtime.runPromise(KeyRuntime.navigate("A", 2));
		expect(await f.selection()).toEqual({ profileId: "a", pageId: "1" });
		expect(f.reset.mock.calls).toEqual([["A"], ["A"], ["A"]]);
		// Re-delivering the selected profile doesn't deactivate its sessions.
		await f.profiles.refresh();
		expect(f.reset).toHaveBeenCalledTimes(3);
	} finally {
		await f.profiles.dispose();
	}
});

it.each(["delivery", "write", "guard"] as const)(
	"preserves audio and selection when %s prevents a profile commit",
	async (failure) => {
		const f = await fixture();
		let current = true;
		try {
			f.deliver.mockImplementation(async () => {
				if (failure === "delivery") throw new Error("delivery failed");
				if (failure === "guard") current = false;
			});
			if (failure === "write")
				storage.write.mockRejectedValueOnce(new Error("write failed"));
			await expect(
				f.profiles.select("b", { deviceId: "A", isCurrent: () => current }),
			).rejects.toThrow();
			expect(await f.selection()).toEqual({ profileId: "a", pageId: "1" });
			expect(f.reset).not.toHaveBeenCalled();
			current = true;
			f.deliver.mockImplementation(async () => {
				expect(f.reset).not.toHaveBeenCalled();
			});
			f.reset.mockImplementation(async (serial) => {
				const persisted = Schema.decodeUnknownSync(ProfileEnvelope)(
					await storage.read(),
				);
				if (serial)
					expect(persisted.activeByDevice[serial]?.profileId).toBe("b");
			});
			await f.profiles.select("b", { deviceId: "A", isCurrent: () => current });
			expect(await f.selection()).toEqual({ profileId: "b", pageId: "1" });
			expect(f.reset.mock.calls).toEqual([["A"], ["desktop-preview"]]);
		} finally {
			await f.profiles.dispose();
		}
	},
);

it("preserves audio when the selection guard expires during persistence", async () => {
	const f = await fixture();
	let current = true;
	let release = () => {};
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered = () => {};
	const writing = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const write = storage.write.getMockImplementation();
	if (!write) throw new Error("Missing storage writer");
	storage.write.mockImplementationOnce(async (value, guard) => {
		entered();
		await blocked;
		await write(value, guard);
	});
	try {
		const result = f.profiles.select("b", {
			deviceId: "A",
			isCurrent: () => current,
		});
		const rejected = expect(result).rejects.toThrow();
		await writing;
		expect(f.reset).not.toHaveBeenCalled();
		current = false;
		release();
		await rejected;
		expect(await f.selection()).toEqual({ profileId: "a", pageId: "1" });
		expect(f.reset).not.toHaveBeenCalled();
	} finally {
		release();
		await f.profiles.dispose();
	}
});

it("keeps a durable multi-device commit successful when one reset rejects", async () => {
	const f = await fixture();
	const warnings: { level: string; message: unknown }[] = [];
	f.reset.mockRejectedValueOnce(
		Object.assign(new Error("private /user/audio.mp3"), { code: "EIO" }),
	);
	try {
		await f.profiles.runtime.runPromise(
			Effect.gen(function* () {
				const repository = yield* ProfileRepository;
				const committed = yield* repository.transact((envelope) =>
					Effect.succeed({
						...envelope,
						activeByDevice: {
							...envelope.activeByDevice,
							A: { profileId: "b", pageId: "1" },
							B: { profileId: "b", pageId: "1" },
						},
					}),
				);
				expect(committed.activeByDevice.A?.profileId).toBe("b");
				expect(committed.activeByDevice.B?.profileId).toBe("b");
				expect(f.reset.mock.calls).toEqual([["A"], ["B"]]);
				yield* repository.select({ deviceId: "A", profileId: "a" });
			}).pipe(
				Effect.provide(
					Logger.replace(
						Logger.defaultLogger,
						Logger.make(({ logLevel, message }) =>
							warnings.push({ level: logLevel.label, message }),
						),
					),
				),
			),
		);
		const persisted = Schema.decodeUnknownSync(ProfileEnvelope)(
			await storage.read(),
		);
		expect(persisted.activeByDevice.B?.profileId).toBe("b");
		expect(warnings).toMatchObject([
			{
				level: "WARN",
				message: [
					"profiles.selection.reset.failed",
					{
						code: "QUAKE.PROFILE.SELECTION_RESET_FAILED",
						diagnosticCause: { sourceCode: "EIO" },
					},
				],
			},
		]);
		expect(JSON.stringify(warnings)).not.toContain("private");
		expect(JSON.stringify(warnings)).not.toContain("audio.mp3");
	} finally {
		await f.profiles.dispose();
	}
});

it("releases the commit mutex after a five-second reset timeout", async () => {
	const f = await fixture();
	const warnings: { level: string; message: unknown }[] = [];
	let release = () => {};
	let entered = false;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	f.reset.mockImplementationOnce(() => {
		entered = true;
		return pending;
	});
	try {
		await f.profiles.runtime.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const repository = yield* ProfileRepository;
					const first = yield* repository
						.select({ deviceId: "A", profileId: "b" })
						.pipe(Effect.forkScoped);
					yield* TestClock.adjust(4999);
					expect(entered).toBe(true);
					expect(Option.isNone(yield* Fiber.poll(first))).toBe(true);
					const queued = yield* repository
						.select({ deviceId: "B", profileId: "b" })
						.pipe(Effect.forkScoped);
					yield* TestClock.adjust(1);
					expect(Option.isSome(yield* Fiber.poll(first))).toBe(true);
					const committed = yield* Fiber.join(first);
					expect(committed.activeByDevice.A?.profileId).toBe("b");
					expect((yield* Fiber.join(queued)).activeByDevice.B?.profileId).toBe(
						"b",
					);
					expect(f.reset.mock.calls).toEqual([["A"], ["B"]]);
				}).pipe(Effect.ensuring(Effect.sync(() => release()))),
			).pipe(
				Effect.provide(TestContext.TestContext),
				Effect.provide(
					Logger.replace(
						Logger.defaultLogger,
						Logger.make(({ logLevel, message }) =>
							warnings.push({ level: logLevel.label, message }),
						),
					),
				),
			),
		);
		expect(warnings).toMatchObject([
			{
				level: "WARN",
				message: [
					"profiles.selection.reset.failed",
					{ code: "QUAKE.PROFILE.SELECTION_RESET_TIMED_OUT" },
				],
			},
		]);
	} finally {
		release();
		await f.profiles.dispose();
	}
});
