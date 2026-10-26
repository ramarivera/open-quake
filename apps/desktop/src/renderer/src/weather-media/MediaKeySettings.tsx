import { Schema } from "effect";
import { useState } from "react";
import { AUDIO_OPERATIONS } from "../../../../../../packages/device/src/actions/action-contracts";
import type { ProfileKey } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { soundboardOwned } from "../strip/tiles/soundboard/soundboard-state";
import { useWeatherMedia } from "./hooks";

const audioLabels = {
	en: [
		"Mute",
		"Volume Down",
		"Volume Up",
		"Play/Pause",
		"Pause",
		"Stop",
		"Previous Track",
		"Next Track",
		"Rewind",
		"Fast Forward",
		"Repeat",
		"Random",
	],
	de: [
		"Stumm",
		"Leiser",
		"Lauter",
		"Wiedergabe/Pause",
		"Pause",
		"Stopp",
		"Vorheriger Titel",
		"Nächster Titel",
		"Zurückspulen",
		"Vorspulen",
		"Wiederholen",
		"Zufällig",
	],
};
export function AudioOperationPicker({
	value,
	onChange,
	locale = "en",
	custom = false,
}: {
	value: string;
	onChange: (value: string) => void;
	locale?: string;
	custom?: boolean;
}): React.JSX.Element {
	const labels = locale === "de" ? audioLabels.de : audioLabels.en;
	return (
		<label>
			{locale === "de" ? "Medienaktion" : "Audio"}
			<select
				aria-label={locale === "de" ? "Medienaktion" : "Audio"}
				value={AUDIO_OPERATIONS.some((v) => v === value) ? value : ""}
				onChange={(e) => {
					if (e.target.value) onChange(e.target.value);
				}}
			>
				{custom ? (
					<option value="">
						{locale === "de" ? "Tastenkürzel" : "Custom shortcut"}
					</option>
				) : null}
				{AUDIO_OPERATIONS.map((token, index) => (
					<option key={token} value={token}>
						{labels[index]}
					</option>
				))}
			</select>
		</label>
	);
}
export function SystemMediaSettings({
	locale = "en",
}: {
	locale?: string;
}): React.JSX.Element {
	const { client, snapshot } = useWeatherMedia();
	const [busy, setBusy] = useState(false),
		[failed, setFailed] = useState(false);
	const de = locale === "de";
	const perform = async (operation: () => Promise<boolean>) => {
		if (busy) return;
		setBusy(true);
		try {
			setFailed(!(await operation()));
		} finally {
			setBusy(false);
		}
	};
	const target = snapshot?.settings.mediaTarget ?? "";
	const sessions = snapshot?.media.sessions ?? [];
	return (
		<fieldset disabled={busy || !snapshot} data-testid="system-media-panel">
			<legend>System Media</legend>
			<p>
				{snapshot?.media.session?.title ||
					(de ? "Keine aktive Mediensitzung" : "No active media session")}
			</p>
			<label>
				{de ? "Mediensitzung" : "Media session"}
				<select
					value={target}
					onChange={(e) =>
						void perform(() =>
							client.configure({ mediaTarget: e.target.value || null }),
						)
					}
				>
					<option value="">
						{de ? "Aktueller Sitzung folgen" : "Follow Current"}
					</option>
					{target && !sessions.some((s) => s.id === target) ? (
						<option value={target}>
							{de ? "Sitzung nicht verfügbar" : "Session unavailable"}
						</option>
					) : null}
					{sessions.map((s) => (
						<option key={s.id} value={s.id}>
							{s.appName} ·{" "}
							{s.playing
								? de
									? "Wiedergabe"
									: "Playing"
								: de
									? "Pausiert"
									: "Paused"}
						</option>
					))}
				</select>
			</label>
			<button
				type="button"
				onClick={() => void perform(() => client.refresh())}
			>
				{de ? "Aktualisieren" : "Refresh"}
			</button>
			<label>
				{de ? "Player öffnen" : "Open player"}
				<select
					value={snapshot?.settings.mediaLauncher ?? "apple"}
					onChange={(e) => {
						const selected = Schema.decodeUnknownSync(
							Schema.Literal("apple", "spotify", "qq", "netease"),
						)(e.target.value);
						void perform(() => client.configure({ mediaLauncher: selected }));
					}}
				>
					<option value="apple">Apple Music</option>
					<option value="spotify">Spotify</option>
					<option value="qq">QQ Music</option>
					<option value="netease">NetEase Cloud Music</option>
				</select>
			</label>
			<button
				type="button"
				onClick={() =>
					void perform(async () => {
						const reply = await client.request({
							_tag: "launch",
							id: snapshot?.settings.mediaLauncher ?? "apple",
						});
						return reply?._tag === "launched" && reply.accepted;
					})
				}
			>
				{de ? "Öffnen" : "Open"}
			</button>
			<p>
				{snapshot?.media.lyrics?._tag === "available"
					? snapshot.media.lyrics.text
					: de
						? "Liedtext nicht verfügbar"
						: "Lyrics unavailable"}
			</p>
			{failed ? (
				<p role="status">
					{de ? "Medienanfrage fehlgeschlagen" : "Media request failed"}
				</p>
			) : null}
		</fieldset>
	);
}
export function MediaKeySettings({
	keyValue,
	onChange,
	locale,
}: {
	keyValue: ProfileKey;
	onChange: (next: ProfileKey) => void;
	locale: string;
}): React.JSX.Element | null {
	const type = keyValue.config.type;
	if (type === "playAudio" || type === "playAudioLegacy") {
		const local = soundboardOwned(keyValue.config);
		return (
			<>
				<label>
					{locale === "de" ? "Musikquelle" : "Music source"}
					<select
						aria-label="Music source"
						value={local ? "local" : "system"}
						onChange={(e) =>
							onChange({
								...keyValue,
								config: {
									...keyValue.config,
									actions: [
										...keyValue.config.actions.filter(
											(a) => a.type !== "musicSource",
										),
										{ type: "musicSource", value: e.target.value },
									],
								},
							})
						}
					>
						<option value="local">
							{locale === "de" ? "Lokale Musik" : "Local Music"}
						</option>
						<option value="system">System Media</option>
					</select>
				</label>
				{!local ? <SystemMediaSettings locale={locale} /> : null}
			</>
		);
	}
	if (type !== "media" && type !== "hotkey") return null;
	return (
		<AudioOperationPicker
			value={String(keyValue.config.actions[0]?.value ?? "")}
			custom={type === "hotkey"}
			locale={locale}
			onChange={(value) =>
				onChange({
					...keyValue,
					config: {
						...keyValue.config,
						actions: keyValue.config.actions.map((a, i) =>
							i === 0 ? { ...a, value } : a,
						),
					},
				})
			}
		/>
	);
}
