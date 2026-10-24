import { Either, Schema } from "effect";
import { useState } from "react";
import {
	defaultMeetingConfig,
	MeetingConfig,
} from "../../../shared/meeting-bridge";
import { meetingRequest } from "./useMeetings";

export function MeetingSettings({
	mock,
	initial = defaultMeetingConfig,
}: {
	mock: boolean;
	initial?: MeetingConfig | undefined;
}): React.JSX.Element {
	const [profileId, setProfileId] = useState<string>(initial.profileId);
	const [devices, setDevices] = useState<readonly MediaDeviceInfo[]>([]);
	const [config, setConfig] = useState(initial),
		[message, setMessage] = useState("");
	return (
		<details className="meeting-settings">
			<summary>Audio sources and models</summary>
			<p>
				{mock
					? "Mock mode uses synthetic audio and fake providers."
					: "Choose a microphone and an explicitly configured AI profile. System audio requires screen recording permission."}
			</p>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					const decoded = Schema.decodeUnknownEither(MeetingConfig)({
						...config,
						profileId,
					});
					if (Either.isLeft(decoded)) {
						setMessage("Check the audio and model configuration");
						return;
					}
					void meetingRequest({
						_tag: "configure",
						config: decoded.right,
					}).then((saved) =>
						setMessage(
							saved
								? "Meeting configuration updated"
								: "Meeting configuration could not be saved",
						),
					);
				}}
			>
				<label>
					Microphone
					<select
						value={config.microphoneId}
						onFocus={() => {
							void navigator.mediaDevices
								?.enumerateDevices()
								.then((devices) =>
									setDevices(devices.filter((d) => d.kind === "audioinput")),
								)
								.catch(() => setMessage("Microphone list is unavailable"));
						}}
						onChange={(event) =>
							setConfig({ ...config, microphoneId: event.target.value })
						}
					>
						<option value="default">Default microphone</option>
						{devices
							.filter((d) => d.deviceId !== "default")
							.map((device, i) => (
								<option key={device.deviceId} value={device.deviceId}>
									{device.label || `Microphone ${i + 1}`}
								</option>
							))}
					</select>
				</label>
				<label className="meeting-checkbox">
					<input
						type="checkbox"
						checked={config.systemAudio}
						onChange={(event) =>
							setConfig({ ...config, systemAudio: event.target.checked })
						}
					/>
					Include system audio
				</label>
				<label>
					Transcription provider
					<select
						value={config.asrProvider}
						onChange={(event) => {
							const value = event.target.value;
							if (
								value === "mock" ||
								value === "dashscope" ||
								value === "openai"
							)
								setConfig({
									...config,
									asrProvider: value,
									asrModel:
										value === "openai"
											? "gpt-realtime-mini"
											: "qwen-audio-3.0-asr-flash-filetrans",
								});
						}}
					>
						<option value="dashscope">DashScope</option>
						<option value="openai">OpenAI</option>
						{mock ? <option value="mock">Mock</option> : null}
					</select>
				</label>
				<label>
					ASR model
					<input
						value={config.asrModel}
						onChange={(event) =>
							setConfig({ ...config, asrModel: event.target.value })
						}
					/>
				</label>
				<label>
					AI profile ID
					<input
						value={profileId}
						onChange={(event) => setProfileId(event.target.value)}
						required
					/>
				</label>
				<label>
					Minutes model
					<input
						value={config.minutesModel}
						onChange={(event) =>
							setConfig({ ...config, minutesModel: event.target.value })
						}
					/>
				</label>
				<label>
					Output language
					<input
						value={config.outputLanguage}
						onChange={(event) =>
							setConfig({ ...config, outputLanguage: event.target.value })
						}
					/>
				</label>
				<label>
					Translation model
					<input
						value={config.translationModel}
						onChange={(event) =>
							setConfig({ ...config, translationModel: event.target.value })
						}
					/>
				</label>
				<label>
					Translation language
					<input
						value={config.targetLanguage}
						onChange={(event) =>
							setConfig({ ...config, targetLanguage: event.target.value })
						}
					/>
				</label>
				<label className="meeting-checkbox">
					<input
						type="checkbox"
						checked={config.autoGenerate}
						onChange={(event) =>
							setConfig({ ...config, autoGenerate: event.target.checked })
						}
					/>
					Generate minutes when recording ends
				</label>
				<button type="submit" className="button">
					Save
				</button>
				<span role="status">{message}</span>
			</form>
		</details>
	);
}
