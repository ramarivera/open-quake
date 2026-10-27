import { expect, it, vi } from "vitest";
import { RestoreFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { importResultText, restoreAndExit } from "./restore-exit";

it("keeps the app running on preflight failure and exits visibly on failure after shutdown", async () => {
	const cause = new Error("token=private-native-detail");
	const stop = vi.fn(async () => {});
	const report = vi.fn(async (_message: string) => {});
	const exit = vi.fn();
	const commit = vi.fn(async () => {
		throw cause;
	});
	await expect(
		restoreAndExit({
			validate: async () => {
				throw cause;
			},
			stop,
			commit,
			report,
			exit,
		}),
	).rejects.toBe(cause);
	expect(stop).not.toHaveBeenCalled();
	expect(exit).not.toHaveBeenCalled();
	const failure: unknown = await restoreAndExit({
		validate: async () => {},
		stop,
		commit,
		report,
		exit,
	}).catch((cause: unknown) => cause);
	expect(failure).toMatchObject({
		_tag: "RestoreFailed",
		code: "QUAKE.BACKUP.RESTORE_FAILED",
	});
	if (!(failure instanceof RestoreFailed))
		throw new Error("Missing restore identity");
	expect(failure.originalCause).toBe(cause);
	expect(JSON.stringify(failure)).not.toContain("private-native-detail");
	expect(stop).toHaveBeenCalledOnce();
	expect(exit).toHaveBeenCalledExactlyOnceWith(1);
	expect(report).toHaveBeenCalledOnce();
	expect(report.mock.calls[0]?.[0]).not.toContain("private-native-detail");
});

it("exits after successful replacement even if its result dialog is unavailable", async () => {
	const exit = vi.fn();
	await restoreAndExit({
		validate: async () => {},
		stop: async () => {},
		commit: async () => ({ imported: 1, skipped: 0 }),
		report: async () => {
			throw new Error("Window is gone");
		},
		exit,
	});
	expect(exit).toHaveBeenCalledExactlyOnceWith(0);
});

it("MGMT-429 reports import counts in every supported active locale", async () => {
	for (const locale of [
		"en",
		"de",
		"es",
		"fr",
		"it",
		"ja",
		"ko",
		"zh",
	] as const) {
		const report = vi.fn(async (_message: string) => {});
		await restoreAndExit({
			locale,
			validate: async () => {},
			stop: async () => {},
			commit: async () => ({ imported: 7, skipped: 2 }),
			report,
			exit: () => {},
		});
		expect(report).toHaveBeenCalledExactlyOnceWith(
			importResultText(locale, { imported: 7, skipped: 2 }),
		);
		if (locale !== "en")
			expect(report.mock.calls[0]?.[0]).not.toContain("Import Success");
	}
});
