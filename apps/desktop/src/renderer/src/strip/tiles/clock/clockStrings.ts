/**
 * DK-Suite 0.4.95 strings, copied verbatim from its eight locale files
 * (`dkDesktopClockLang.*` and `settings.clock*`). Do not paraphrase them.
 */
import type { ThemeId } from "../../../../../shared/clock-style";

export const CLOCK_LOCALES = [
	"en",
	"zh",
	"ja",
	"ko",
	"de",
	"fr",
	"es",
	"it",
] as const;
export type ClockLocale = (typeof CLOCK_LOCALES)[number];

export interface ClockStrings {
	/** Sunday first, matching `Date.prototype.getDay`. */
	readonly weekdays: readonly [
		string,
		string,
		string,
		string,
		string,
		string,
		string,
	];
	readonly am: string;
	readonly pm: string;
	readonly themes: Readonly<Record<ThemeId, string>>;
	readonly themePrev: string;
	readonly themeNext: string;
	readonly settings: {
		readonly themeSection: string;
		readonly themeNone: string;
		readonly themeChange: string;
		readonly themeRestore: string;
		readonly themeOverrideBadge: string;
		readonly formatCard: string;
		readonly mediaUnusable: string;
		readonly hourFormat24h: string;
		readonly hourFormat12h: string;
	};
}

export const CLOCK_STRINGS: Readonly<Record<ClockLocale, ClockStrings>> = {
	en: {
		weekdays: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
		am: "AM",
		pm: "PM",
		themes: {
			season: "Season",
			cyber: "Cyberpunk",
			anime: "Anime",
			tactical: "Tactical",
			aurora: "Aurora",
		},
		themePrev: "Previous theme",
		themeNext: "Next theme",
		settings: {
			themeSection: "Theme background",
			themeNone: "None",
			themeChange: "Change background",
			themeRestore: "Restore default background",
			themeOverrideBadge: "Custom",
			formatCard: "Clock format",
			mediaUnusable: "File missing or unusable; fell back to built-in",
			hourFormat24h: "24-Hour",
			hourFormat12h: "12-Hour (AM/PM)",
		},
	},
	zh: {
		weekdays: [
			"星期日",
			"星期一",
			"星期二",
			"星期三",
			"星期四",
			"星期五",
			"星期六",
		],
		am: "AM",
		pm: "PM",
		themes: {
			season: "Season",
			cyber: "Cyberpunk",
			anime: "Anime",
			tactical: "Tactical",
			aurora: "Aurora",
		},
		themePrev: "上一主题",
		themeNext: "下一主题",
		settings: {
			themeSection: "主题背景",
			themeNone: "无背景",
			themeChange: "更换背景",
			themeRestore: "恢复默认背景",
			themeOverrideBadge: "自定义",
			formatCard: "时钟格式",
			mediaUnusable: "File missing or unusable; fell back to built-in",
			hourFormat24h: "24 小时制",
			hourFormat12h: "12 小时制",
		},
	},
	ja: {
		weekdays: ["日", "月", "火", "水", "木", "金", "土"],
		am: "AM",
		pm: "PM",
		themes: {
			season: "Season",
			cyber: "Cyberpunk",
			anime: "Anime",
			tactical: "Tactical",
			aurora: "Aurora",
		},
		themePrev: "前のテーマ",
		themeNext: "次のテーマ",
		settings: {
			themeSection: "テーマ背景",
			themeNone: "背景なし",
			themeChange: "背景を変更",
			themeRestore: "デフォルト背景に戻す",
			themeOverrideBadge: "カスタム",
			formatCard: "時計形式",
			mediaUnusable: "File missing or unusable; fell back to built-in",
			hourFormat24h: "24時間表示",
			hourFormat12h: "12時間表示（AM/PM）",
		},
	},
	ko: {
		weekdays: ["일", "월", "화", "수", "목", "금", "토"],
		am: "AM",
		pm: "PM",
		themes: {
			season: "Season",
			cyber: "Cyberpunk",
			anime: "Anime",
			tactical: "Tactical",
			aurora: "Aurora",
		},
		themePrev: "이전 테마",
		themeNext: "다음 테마",
		settings: {
			themeSection: "테마 배경",
			themeNone: "배경 없음",
			themeChange: "배경 변경",
			themeRestore: "기본 배경 복원",
			themeOverrideBadge: "사용자 지정",
			formatCard: "시계 형식",
			mediaUnusable: "File missing or unusable; fell back to built-in",
			hourFormat24h: "24시간제",
			hourFormat12h: "12시간제 (AM/PM)",
		},
	},
	de: {
		weekdays: ["SO", "MO", "DI", "MI", "DO", "FR", "SA"],
		am: "AM",
		pm: "PM",
		themes: {
			season: "Season",
			cyber: "Cyberpunk",
			anime: "Anime",
			tactical: "Tactical",
			aurora: "Aurora",
		},
		themePrev: "Vorheriges Thema",
		themeNext: "Nächstes Thema",
		settings: {
			themeSection: "Themenhintergrund",
			themeNone: "Kein Hintergrund",
			themeChange: "Hintergrund ändern",
			themeRestore: "Standardhintergrund wiederherstellen",
			themeOverrideBadge: "Benutzerdefiniert",
			formatCard: "Uhrformat",
			mediaUnusable: "File missing or unusable; fell back to built-in",
			hourFormat24h: "24-Stunden",
			hourFormat12h: "12-Stunden (AM/PM)",
		},
	},
	fr: {
		weekdays: ["DIM", "LUN", "MAR", "MER", "JEU", "VEN", "SAM"],
		am: "AM",
		pm: "PM",
		themes: {
			season: "Season",
			cyber: "Cyberpunk",
			anime: "Anime",
			tactical: "Tactical",
			aurora: "Aurora",
		},
		themePrev: "Thème précédent",
		themeNext: "Thème suivant",
		settings: {
			themeSection: "Fond du thème",
			themeNone: "Aucun fond",
			themeChange: "Changer le fond",
			themeRestore: "Restaurer le fond par défaut",
			themeOverrideBadge: "Personnalisé",
			formatCard: "Format de l'horloge",
			mediaUnusable: "File missing or unusable; fell back to built-in",
			hourFormat24h: "24 heures",
			hourFormat12h: "12 heures (AM/PM)",
		},
	},
	es: {
		weekdays: ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"],
		am: "AM",
		pm: "PM",
		themes: {
			season: "Season",
			cyber: "Cyberpunk",
			anime: "Anime",
			tactical: "Tactical",
			aurora: "Aurora",
		},
		themePrev: "Tema anterior",
		themeNext: "Tema siguiente",
		settings: {
			themeSection: "Fondo de tema",
			themeNone: "Sin fondo",
			themeChange: "Cambiar fondo",
			themeRestore: "Restaurar fondo predeterminado",
			themeOverrideBadge: "Personalizado",
			formatCard: "Formato del reloj",
			mediaUnusable: "File missing or unusable; fell back to built-in",
			hourFormat24h: "24 horas",
			hourFormat12h: "12 horas (AM/PM)",
		},
	},
	it: {
		weekdays: ["DOM", "LUN", "MAR", "MER", "GIO", "VEN", "SAB"],
		am: "AM",
		pm: "PM",
		themes: {
			season: "Season",
			cyber: "Cyberpunk",
			anime: "Anime",
			tactical: "Tactical",
			aurora: "Aurora",
		},
		themePrev: "Tema precedente",
		themeNext: "Tema successivo",
		settings: {
			themeSection: "Sfondo tema",
			themeNone: "Nessuno sfondo",
			themeChange: "Cambia sfondo",
			themeRestore: "Ripristina sfondo predefinito",
			themeOverrideBadge: "Personalizzato",
			formatCard: "Formato orologio",
			mediaUnusable: "File missing or unusable; fell back to built-in",
			hourFormat24h: "24 ore",
			hourFormat12h: "12 ore (AM/PM)",
		},
	},
};

/** zh-CN → zh, pt-BR → en: the eight DK locales with English as fallback. */
export function normalizeClockLocale(
	language: string | undefined,
): ClockLocale {
	const base = (language ?? "").toLowerCase().split(/[-_]/)[0] ?? "";
	return CLOCK_LOCALES.find((locale) => locale === base) ?? "en";
}
