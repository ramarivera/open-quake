import { RestoreFailed } from "../../../../../packages/edge/src/maintenance/maintenance-errors.js";
import type { AppLocale } from "../../shared/locale";

/** Once shutdown starts, main reports the result and exits even if a window or commit is lost. */
export async function restoreAndExit(options: {
	readonly locale?: AppLocale;
	readonly validate: () => Promise<void>;
	readonly stop: () => Promise<void>;
	readonly commit: () => Promise<{
		readonly skipped: number;
		readonly imported: number;
	}>;
	readonly report: (message: string) => Promise<unknown>;
	readonly exit: (code: number) => void | Promise<void>;
}): Promise<void> {
	await options.validate();
	let code = 1;
	try {
		await options.stop();
		const result = await options.commit();
		code = 0;
		await options
			.report(importResultText(options.locale ?? "en", result))
			.catch(() => undefined);
	} catch (cause) {
		const error = new RestoreFailed(cause);
		await options
			.report(
				`Import could not finish (${error.code}). Reopen open-quake. The original data was retained if replacement failed.`,
			)
			.catch(() => undefined);
		throw error;
	} finally {
		await options.exit(code);
	}
}

export function importResultText(
	locale: AppLocale,
	result: { imported: number; skipped: number },
): string {
	const { imported, skipped } = result;
	switch (locale) {
		case "de":
			return `Import erfolgreich (${skipped} übersprungen, ${imported} importiert). Öffne open-quake erneut.`;
		case "es":
			return `Importación completada (${skipped} omitidos, ${imported} importados). Vuelve a abrir open-quake.`;
		case "fr":
			return `Importation réussie (${skipped} ignorés, ${imported} importés). Rouvrez open-quake.`;
		case "it":
			return `Importazione riuscita (${skipped} ignorati, ${imported} importati). Riapri open-quake.`;
		case "ja":
			return `インポート成功（スキップ ${skipped} 件、インポート ${imported} 件）。open-quake を再起動してください。`;
		case "ko":
			return `가져오기 성공 (건너뜀 ${skipped}개, 가져옴 ${imported}개). open-quake를 다시 여세요.`;
		case "zh":
			return `导入成功（跳过 ${skipped} 项，导入 ${imported} 项）。请重新打开 open-quake。`;
		case "en":
			return `Import Success (${skipped} skipped, ${imported} imported). Reopen open-quake.`;
	}
}
