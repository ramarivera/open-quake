import { expect, it, vi } from "vitest";
import { RestoreFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import { restoreAndExit } from "./restore-exit";

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
	for (const [locale, message] of [
		["en", "Import Success (2 skipped, 7 imported). Reopen open-quake."],
		[
			"de",
			"Import erfolgreich (2 übersprungen, 7 importiert). Öffne open-quake erneut.",
		],
		[
			"es",
			"Importación completada (2 omitidos, 7 importados). Vuelve a abrir open-quake.",
		],
		["fr", "Importation réussie (2 ignorés, 7 importés). Rouvrez open-quake."],
		[
			"it",
			"Importazione riuscita (2 ignorati, 7 importati). Riapri open-quake.",
		],
		[
			"ja",
			"インポート成功（スキップ 2 件、インポート 7 件）。open-quake を再起動してください。",
		],
		["ko", "가져오기 성공 (건너뜀 2개, 가져옴 7개). open-quake를 다시 여세요."],
		["zh", "导入成功（跳过 2 项，导入 7 项）。请重新打开 open-quake。"],
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
		expect(report).toHaveBeenCalledExactlyOnceWith(message);
		if (locale !== "en")
			expect(report.mock.calls[0]?.[0]).not.toContain("Import Success");
	}
});
