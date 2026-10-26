import strings from "./strings.json";

const locales: Readonly<
	Record<
		string,
		{
			readonly config: Readonly<Record<string, string>>;
			readonly labels: Readonly<Record<string, string>>;
			readonly status: Readonly<Record<string, string>>;
		}
	>
> = strings;
export const obsText = (
	locale: string,
	group: "config" | "labels" | "status",
	key: string,
): string => locales[locale]?.[group][key] ?? locales.en?.[group][key] ?? key;
