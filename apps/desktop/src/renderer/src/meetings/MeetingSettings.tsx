import { Either, Schema } from "effect";
import { useRef, useState } from "react";
import {
	defaultMeetingConfig,
	MeetingConfig,
} from "../../../shared/meeting-bridge";
import { SharedMicrophonePicker } from "../speech/SpeechSettings";
import { meetingRequest } from "./useMeetings";

export function MeetingSettings({
	mock,
	initial = defaultMeetingConfig,
}: {
	mock: boolean;
	initial?: MeetingConfig | undefined;
}): React.JSX.Element {
	const [profileId, setProfileId] = useState<string>(initial.profileId);

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
				<SharedMicrophonePicker />
				<SystemAudioSetup />
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

function SystemAudioSetup(): React.JSX.Element {
	const [status, setStatus] = useState("");
	const [open, setOpen] = useState(false);
	const version = useRef(0);
	const refresh = async () => {
		const request = ++version.current;
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			if (request === version.current)
				setStatus(
					devices.some(
						(d) =>
							d.kind === "audioinput" && /BlackHole|Monitor/i.test(d.label),
					)
						? "System audio input available"
						: "No BlackHole or Monitor input found",
				);
		} catch {
			if (request === version.current)
				setStatus(
					"System audio inputs couldn't be checked. Refresh to try again.",
				);
		}
	};
	return (
		<div>
			<button
				type="button"
				onClick={() => {
					setOpen(true);
					void refresh();
				}}
			>
				System audio setup
			</button>
			{open ? (
				<section aria-label="System audio setup">
					<p>
						Windows uses desktop loopback. macOS and Linux require an installed
						BlackHole or Monitor input. On macOS, create a Multi-Output Device
						in Audio MIDI Setup, select your output and BlackHole, and route
						system sound to it. Grant microphone access. No driver or audio
						routing is changed here.
					</p>
					<p role="status">{status}</p>
					<button
						type="button"
						onClick={() => {
							void refresh();
						}}
					>
						Refresh inputs
					</button>
					<button
						type="button"
						onClick={() => {
							version.current++;
							setOpen(false);
						}}
					>
						Cancel
					</button>
				</section>
			) : null}
		</div>
	);
}
