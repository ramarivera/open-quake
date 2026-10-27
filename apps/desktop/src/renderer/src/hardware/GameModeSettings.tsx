import { Either, Schema } from "effect";
import { useState } from "react";
import type { ProfileKey } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { HardwareResponse } from "../../../shared/hardware-contracts";
import { Row } from "../ui/Form";
import { type HardwareTextKey, useHardwareText } from "./strings";
export function GameModeSettings({
	value,
	onChange,
}: {
	value: ProfileKey;
	onChange: (value: ProfileKey) => void;
}): React.JSX.Element {
	const t = useHardwareText();
	const [error, setError] = useState<HardwareTextKey>();
	const path = value.config.actions.find((a) => a.type === "path")?.value;
	const monitor = value.config.actions.some(
		(a) => a.type === "monitorAppView" && a.value === true,
	);
	const change = (type: string, next: string | boolean) =>
		onChange({
			...value,
			config: {
				...value.config,
				actions: [
					...value.config.actions.filter((a) => a.type !== type),
					{ type, value: next },
				],
			},
		});
	const choose = async (kind: "file" | "folder" | "application") => {
		setError(undefined);
		try {
			const decoded = Schema.decodeUnknownEither(HardwareResponse)(
				await window.quakeHardware?.request({ _tag: "chooseGameTarget", kind }),
			);
			if (Either.isLeft(decoded)) {
				setError("pickerFailed");
				return;
			}
			const reply = decoded.right;
			if (reply._tag === "gameTarget") change("path", reply.path);
			else if (reply._tag !== "cancelled") setError("pickerFailed");
		} catch {
			setError("pickerFailed");
		}
	};
	return (
		<>
			<Row label={t("target")}>
				<input
					aria-label={t("gameTarget")}
					value={typeof path === "string" ? path : ""}
					onChange={(e) => change("path", e.target.value)}
				/>
				{(["application", "file", "folder"] as const).map((kind) => (
					<button type="button" key={kind} onClick={() => void choose(kind)}>
						{t(
							(
								{
									application: "chooseApplication",
									file: "chooseFile",
									folder: "chooseFolder",
								} as const
							)[kind],
						)}
					</button>
				))}
			</Row>
			<Row label={t("showForeground")} htmlFor="game-monitor">
				<input
					id="game-monitor"
					type="checkbox"
					checked={monitor}
					onChange={(e) => change("monitorAppView", e.target.checked)}
				/>
			</Row>
			{error && <p role="alert">{t(error)}</p>}
		</>
	);
}
