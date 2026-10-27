import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
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
	const openInstaller = vi.fn(async () => {});
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
