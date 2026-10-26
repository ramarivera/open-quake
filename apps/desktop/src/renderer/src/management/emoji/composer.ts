export const utf8Length = (value: string): number =>
	new TextEncoder().encode(value).length;
const en = [
	"Wave happily and blink",
	"Sway side to side to celebrate",
	"Shyly cover the face",
	"Jump in surprise",
	"Nod",
	"Make a heart with hands",
];
const de = [
	"Fröhlich winken und blinzeln",
	"Seitwärts schwingen zum Feiern",
	"Schüchtern das Gesicht bedecken",
	"Überrascht hochspringen",
	"Nicken",
	"Herz mit den Händen formen",
];
export const motionPresets = (locale: string): readonly string[] =>
	locale === "de" ? de : en;
export const defaultMotion = (locale: string): string =>
	locale === "de"
		? "Zweimal fröhlich winken, leicht hüpfen, dann blinzeln"
		: "Wave happily twice, bounce lightly, then blink";
