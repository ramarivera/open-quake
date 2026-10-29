import {
	keyText,
	keyTitle,
} from "../../../../../../packages/device/src/profiles/key-editing-invariants";
import type { ProfilePage } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { keySpan } from "../../../../../../packages/device/src/profiles/profile-footprint";
import type { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts";
import { useLocaleText } from "../i18n";

export function KeyTable({
	page,
	locale,
	selected,
	dirty,
	choose,
}: {
	page: ProfilePage;
	locale: ProfileLocale;
	selected?: string | undefined;
	dirty: boolean;
	choose: (code: string) => void;
}): React.JSX.Element {
	const t = useLocaleText("keysEditor", locale);
	const keys = page.keys
		.filter((key) => key.config.type)
		.sort((a, b) =>
			a.keyCode.localeCompare(b.keyCode, undefined, { numeric: true }),
		);
	return (
		<section className="keys-table" aria-label={t("tiles")}>
			<h2>{t("tiles")}</h2>
			<table>
				<thead>
					<tr>
						{["position", "tile", "kind", "size", "state"].map((label) => (
							<th key={label} scope="col">
								{t(label)}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{keys.map((key) => {
						const [row = 1, column = 1] = key.keyCode.split(",").map(Number);
						const name =
							keyTitle(key, locale) || keyText(key.config.type, locale);
						const size = keySpan(key.config);
						return (
							<tr key={key.keyCode} data-selected={selected === key.keyCode}>
								<td>
									<code>
										{String.fromCharCode(64 + column)}
										{row}
									</code>
								</td>
								<th scope="row">
									<button
										type="button"
										aria-pressed={selected === key.keyCode}
										onClick={() => choose(key.keyCode)}
									>
										{name}
									</button>
								</th>
								<td>
									{key.config.type === "quakeBotInput"
										? t("agentInput")
										: keyText(key.config.type, locale)}
								</td>
								<td>{size.join("×")}</td>
								<td data-edited={dirty && selected === key.keyCode}>
									{t(dirty && selected === key.keyCode ? "edited" : "saved")}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
			{keys.length === 0 ? <p>{t("choose")}</p> : null}
		</section>
	);
}
