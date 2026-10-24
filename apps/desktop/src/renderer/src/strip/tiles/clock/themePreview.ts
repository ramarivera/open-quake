import type {
	ThemeId,
	ThemePatchReason,
} from "../../../../../shared/clock-style";

export type ClockThemeResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: ThemePatchReason };
export type ClockThemeSelect = (themeId: ThemeId) => Promise<ClockThemeResult>;

/**
 * Optimistic theme preview for the on-device ◀/▶ buttons (DK-Suite BR-45/50).
 * A selection shows at once; a failed or thrown save reverts to the persisted
 * theme. Each selection gets a token, so a late failure of an older save never
 * undoes a newer choice (DK-Suite would). A new persisted theme ends the
 * preview.
 */
export class ThemePreviewController {
	private preview: ThemeId | null = null;
	private token = 0;

	constructor(
		private readonly onChange: (preview: ThemeId | null) => void,
		private readonly onRollback: (
			themeId: ThemeId,
			reason: string,
		) => void = () => {},
	) {}

	get current(): ThemeId | null {
		return this.preview;
	}

	select(themeId: ThemeId, save: ClockThemeSelect | undefined): void {
		const token = ++this.token;
		this.set(themeId);
		if (!save) return;
		let pending: Promise<ClockThemeResult>;
		try {
			pending = save(themeId);
		} catch (cause) {
			this.rollback(token, themeId, String(cause));
			return;
		}
		pending.then(
			(result) => {
				if (!result.ok) this.rollback(token, themeId, result.reason);
			},
			(cause: unknown) =>
				this.rollback(
					token,
					themeId,
					cause instanceof Error ? cause.message : String(cause),
				),
		);
	}

	/** The persisted theme changed (config echo or another window's save). */
	persisted(): void {
		this.token++;
		this.set(null);
	}

	dispose(): void {
		this.token++;
	}

	private rollback(token: number, themeId: ThemeId, reason: string): void {
		if (token !== this.token) return;
		this.set(null);
		this.onRollback(themeId, reason);
	}

	private set(preview: ThemeId | null): void {
		if (preview === this.preview) return;
		this.preview = preview;
		this.onChange(preview);
	}
}
