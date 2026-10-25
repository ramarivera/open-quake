/** ISO 3166-1 alpha-2 regions. Names come from the bundled ICU data, offline. */
const CODES =
	"AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW";
export const REGION_CODES: ReadonlyArray<string> = CODES.split(" ");
const REGION = /^[A-Z]{2}$/;

export const isRegion = (value: string): boolean =>
	REGION.test(value) && REGION_CODES.includes(value);

/** A suggestion from the OS locale only; it is saved when the user continues. */
export function regionFromLocale(locale: string | undefined): string | null {
	if (!locale) return null;
	try {
		const region = new Intl.Locale(locale).maximize().region ?? "";
		return isRegion(region) ? region : null;
	} catch {
		return null;
	}
}

export function regionOptions(
	locale: string,
): ReadonlyArray<{ readonly code: string; readonly name: string }> {
	let names: Intl.DisplayNames | null = null;
	try {
		names = new Intl.DisplayNames([locale], { type: "region" });
	} catch {
		names = null;
	}
	const collator = new Intl.Collator(locale);
	return REGION_CODES.map((code) => ({
		code,
		name: names?.of(code) ?? code,
	})).sort((a, b) => collator.compare(a.name, b.name));
}
