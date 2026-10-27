import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, it, vi } from "vitest";
import {
	audioSetup,
	openBlackHoleInstaller,
	verifyBlackHolePackage,
} from "./audio-setup";

it("AI-283 requires fresh consent, handles cancellation/failure/retry and never installs in mock or non-macOS", async () => {
	const confirm = vi.fn(async () => false);
	const select = vi.fn(
		async (): Promise<string | undefined> => "BlackHole.pkg",
	);
	const openInstaller = vi.fn(async () => undefined);
	const port = {
		platform: "darwin",
		mock: false,
		confirm,
		select,
		openInstaller,
	};
	const owner = audioSetup(port);
	expect(await Effect.runPromise(owner.install())).toMatchObject({
		state: "cancelled",
	});
	expect(select).not.toHaveBeenCalled();
	confirm.mockResolvedValue(true);
	select.mockResolvedValueOnce(undefined);
	expect(await Effect.runPromise(owner.install())).toMatchObject({
		state: "cancelled",
	});
	expect(openInstaller).not.toHaveBeenCalled();
	openInstaller.mockRejectedValueOnce(new Error("native failure"));
	expect(await Effect.runPromise(owner.install())).toMatchObject({
		state: "failed",
	});
	expect(await Effect.runPromise(owner.install())).toMatchObject({
		state: "opened",
	});
	const count = confirm.mock.calls.length;
	for (const overrides of [
		{ mock: true },
		{ platform: "linux" },
		{ platform: "win32" },
	])
		await Effect.runPromise(audioSetup({ ...port, ...overrides }).install());
	expect(confirm).toHaveBeenCalledTimes(count);
});
it("AI-283 verifies the isolated copy before the real package handoff and cleans failed attempts", async () => {
	const root = await mkdtemp(join(tmpdir(), "audio-setup-"));
	const selected = join(root, "BlackHole2ch.pkg");
	const storage = join(root, "handoffs");
	await writeFile(selected, "nonexecutable synthetic package");
	const launch = vi.fn(async (path: string) => {
		expect(path).not.toBe(selected);
		expect(await readFile(path, "utf8")).toBe(
			"nonexecutable synthetic package",
		);
		return "";
	});
	const verify = vi.fn(async () => {
		throw new Error("untrusted signature");
	});
	try {
		await expect(
			openBlackHoleInstaller({ selected, root: storage, verify, open: launch }),
		).rejects.toBeDefined();
		expect(launch).not.toHaveBeenCalled();
		expect(await readdir(storage)).toEqual([]);
		const trusted = vi.fn(async (path: string) => {
			expect(await readFile(path, "utf8")).toContain("synthetic");
		});
		await openBlackHoleInstaller({
			selected,
			root: storage,
			verify: trusted,
			open: launch,
		});
		expect(trusted).toHaveBeenCalledOnce();
		expect(launch).toHaveBeenCalledOnce();
		const link = join(root, "BlackHole-link.pkg");
		await symlink(selected, link);
		await expect(
			openBlackHoleInstaller({
				selected: link,
				root: storage,
				verify: trusted,
				open: launch,
			}),
		).rejects.toBeDefined();
		expect(launch).toHaveBeenCalledOnce();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

it("AI-283 rejects an untrusted installer assessment or foreign signer before handoff", async () => {
	const run = vi.fn(async (_command: string, _args: readonly string[]) => ({
		stdout: "Developer ID Installer: Existential Audio Inc. (5FCN7X64RK)",
	}));
	await verifyBlackHolePackage("fake.pkg", run);
	expect(run.mock.calls.map(([command]) => command)).toEqual([
		"/usr/sbin/spctl",
		"/usr/sbin/pkgutil",
	]);
	run.mockRejectedValueOnce(new Error("Gatekeeper denied"));
	await expect(verifyBlackHolePackage("fake.pkg", run)).rejects.toBeDefined();
	run.mockResolvedValue({
		stdout: "Developer ID Installer: Foreign Publisher (AAAAAAAAAA)",
	});
	await expect(verifyBlackHolePackage("fake.pkg", run)).rejects.toMatchObject({
		code: "QUAKE.MEETING.INVALID",
	});
});

// Every handoff and verifier is fake; these tests exercise real filesystem retention.
it("AI-283 bounds retained copies across cancellation, retries, concurrency and restart without deleting an active package", async () => {
	const root = await mkdtemp(join(tmpdir(), "audio-retention-"));
	const selected = join(root, "BlackHole.pkg");
	const storage = join(root, "handoffs");
	await writeFile(selected, "synthetic package");
	const paths: string[] = [];
	const options = {
		selected,
		root: storage,
		verify: async () => {},
		open: async (path: string) => {
			paths.push(path);
			return "";
		},
	};
	try {
		// Native cancellation is a failed handoff and frees only its own slot.
		await expect(
			openBlackHoleInstaller({ ...options, open: async () => "cancelled" }),
		).rejects.toBeDefined();
		expect(await readdir(storage)).toEqual([]);
		await openBlackHoleInstaller(options);
		const retained = paths[0];
		if (!retained) throw new Error("Missing retained package");
		// Age alone cannot prove Installer is inactive. Preserve old copies too.
		await utimes(retained, new Date(0), new Date(0));
		await Promise.all([
			openBlackHoleInstaller(options),
			openBlackHoleInstaller(options),
		]);
		expect(paths).toHaveLength(2);
		expect(new Set(paths).size).toBe(2);
		expect(await readdir(storage)).toHaveLength(2);
		// A fresh call has no in-memory state, just like the next application startup.
		expect(await openBlackHoleInstaller({ ...options })).toBe("storage-full");
		expect(paths).toHaveLength(2);
		for (const path of paths)
			expect(await readFile(path, "utf8")).toBe("synthetic package");
		expect((await stat(retained)).mtimeMs).toBe(0);
		// Simulate the user's cleanup after closing Installer, then retry.
		await rm(join(storage, "blackhole-slot-0"), { recursive: true });
		await openBlackHoleInstaller(options);
		expect(paths).toHaveLength(3);
		expect(await readdir(storage)).toHaveLength(2);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
it("AI-283 counts legacy and crash-interrupted copies against the persistent admission bound", async () => {
	const root = await mkdtemp(join(tmpdir(), "audio-retention-legacy-"));
	const selected = join(root, "BlackHole.pkg");
	const storage = join(root, "handoffs");
	await mkdir(join(storage, "blackhole-old"), { recursive: true });
	await writeFile(
		join(storage, "blackhole-old", "BlackHole.pkg"),
		"legacy active copy",
	);
	await mkdir(join(storage, "blackhole-slot-1"));
	await writeFile(selected, "synthetic package");
	const open = vi.fn(async () => "");
	try {
		expect(
			await openBlackHoleInstaller({ selected, root: storage, open }),
		).toBe("storage-full");
		expect(open).not.toHaveBeenCalled();
		expect(await readdir(storage)).toHaveLength(2);
		expect(
			await readFile(join(storage, "blackhole-old", "BlackHole.pkg"), "utf8"),
		).toBe("legacy active copy");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
it("AI-283 exposes full storage as a retryable result after fresh consent", async () => {
	const confirm = vi.fn(async () => true);
	const owner = audioSetup({
		platform: "darwin",
		mock: false,
		confirm,
		select: async () => "BlackHole.pkg",
		openInstaller: async () => "storage-full",
	});
	for (let attempt = 0; attempt < 2; attempt++)
		expect(await Effect.runPromise(owner.install())).toMatchObject({
			state: "storage-full",
		});
	expect(confirm).toHaveBeenCalledTimes(2);
});
