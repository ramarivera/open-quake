import type { ProfileKey } from "../../../../../../../../packages/device/src/profiles/profile-contracts";
import { type StripLocale, stripText } from "../../overlays/voice/strings";
import { readerSettings } from "./reader-settings";

export function AudioBotSettings({
	keyValue,
	locale,
	onChange,
}: {
	keyValue: ProfileKey;
	locale: StripLocale;
	onChange: (key: ProfileKey) => void;
}): React.JSX.Element | null {
	if (
		keyValue.config.type !== "audioBot" &&
		keyValue.config.type !== "quakeBot"
	)
		return null;
	const settings = readerSettings(keyValue.config.actions);
	const update = (type: string, value: string | number) => {
		const actions = keyValue.config.actions;
		onChange({
			...keyValue,
			config: {
				...keyValue.config,
				actions: actions.some((a) => a.type === type)
					? actions.map((a) => (a.type === type ? { ...a, value } : a))
					: [...actions, { type, value }],
			},
		});
	};
	return (
		<fieldset>
			<legend>
				{stripText(locale, "operationConfiguration.audioBotTtsEngine")}
			</legend>
			<label>
				{stripText(locale, "operationConfiguration.audioBotTtsEngine")}
				<select
					value={settings.engine}
					onChange={(e) => update("ttsEngine", e.target.value)}
				>
					<option value="qwen">
						{stripText(locale, "operationConfiguration.audioBotTtsEngineQwen")}
					</option>
					<option value="webSpeech">
						{stripText(
							locale,
							"operationConfiguration.audioBotTtsEngineWebSpeech",
						)}
					</option>
				</select>
			</label>
			{settings.engine === "webSpeech" ? (
				<>
					<label>
						Voice
						<input
							value={settings.voiceHint}
							maxLength={128}
							onChange={(e) => update("ttsVoice", e.target.value)}
						/>
					</label>
					<label>
						Rate
						<input
							type="number"
							min={0.5}
							max={2}
							step={0.05}
							value={settings.rate}
							onChange={(e) => update("ttsRate", e.target.value)}
						/>
					</label>
					<label>
						Pitch
						<input
							type="number"
							min={0}
							max={2}
							step={0.05}
							value={settings.pitch}
							onChange={(e) => update("ttsPitch", e.target.value)}
						/>
					</label>
					<label>
						Volume
						<input
							type="number"
							min={0}
							max={1}
							step={0.05}
							value={settings.volume}
							onChange={(e) => update("ttsVolume", e.target.value)}
						/>
					</label>
				</>
			) : null}
		</fieldset>
	);
}
