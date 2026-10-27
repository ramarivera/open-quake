import { Either, Schema } from "effect";
import { useId, useRef, useState } from "react";
import {
	AudioSetupReply,
	BLACKHOLE_WARNING,
} from "../../../shared/audio-setup";
import {
	defaultMeetingConfig,
	MeetingConfig,
} from "../../../shared/meeting-bridge";
import { TranslationLanguageSelect } from "../settings/TranslationLanguageSelect";
import { SharedMicrophonePicker } from "../speech/SpeechSettings";
import { meetingRequest } from "./useMeetings";

export function MeetingSettings({
	mock,
	initial = defaultMeetingConfig,
}: {
	mock: boolean;
	initial?: MeetingConfig | undefined;
}): React.JSX.Element {
	const translationId = useId();
	const [profileId, setProfileId] = useState<string>(initial.profileId);

	const [config, setConfig] = useState(initial),
		[message, setMessage] = useState("");
	return (
		<details className="meeting-settings">
			<summary>Audio sources and models</summary>
			<p>
				{mock
					? "Mock mode uses synthetic audio and fake providers."
					: "Choose a microphone and an explicitly configured AI profile. System audio uses Windows loopback or a configured BlackHole or Monitor input."}
			</p>
			<SharedMicrophonePicker />
			<SystemAudioSetup />
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
				<label htmlFor={translationId}>
					Translation language
					<TranslationLanguageSelect
						id={translationId}
						value={config.targetLanguage}
						onChange={(targetLanguage) =>
							setConfig({ ...config, targetLanguage })
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
	const [installable, setInstallable] = useState(false);
	const [consent, setConsent] = useState(false);
	const [busy, setBusy] = useState(false);
	const setup = async (action: "status" | "install") => {
		try {
			const result = Schema.decodeUnknownSync(AudioSetupReply)(
				await window.quakeMeetings?.audioSetup?.({ action }),
			);
			setInstallable(
				result.platform === "darwin" &&
					result.state !== "mock" &&
					result.state !== "unsupported",
			);
			if (action === "install")
				setStatus(
					result.state === "opened"
						? "macOS Installer opened. Complete or cancel there, then refresh inputs. Installation and routing aren't confirmed."
						: result.state === "cancelled"
							? "Installation cancelled."
							: "Installation couldn't start. Choose an official signed BlackHole package and retry.",
				);
		} catch {
			if (action === "install")
				setStatus("Installation couldn't start. Try again.");
		}
	};
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
				className="button"
				onClick={() => {
					setOpen(true);
					void refresh();
					void setup("status");
				}}
			>
				System audio setup
			</button>
			{open ? (
				<section
					className="meeting-audio-setup"
					aria-label="System audio setup"
				>
					<p>
						Windows uses desktop loopback. macOS and Linux require an installed
						BlackHole or Monitor input. On macOS, create a Multi-Output Device
						in Audio MIDI Setup, select your output and BlackHole, and route
						system sound to it. Grant microphone access. Audio routing remains
						your choice.
					</p>
					<p role="status">{status}</p>
					{installable ? (
						<>
							<p>{BLACKHOLE_WARNING}</p>
							<label className="meeting-checkbox">
								<input
									type="checkbox"
									checked={consent}
									disabled={busy}
									onChange={(event) => setConsent(event.target.checked)}
								/>
								I understand and want to choose a BlackHole installer.
							</label>
							<button
								type="button"
								className="button"
								disabled={!consent || busy}
								onClick={() => {
									setBusy(true);
									void setup("install").finally(() => {
										setBusy(false);
										setConsent(false);
									});
								}}
							>
								{busy ? "Opening installer…" : "Install BlackHole…"}
							</button>
						</>
					) : null}
					<button
						type="button"
						className="button"
						onClick={() => {
							void refresh();
						}}
					>
						Refresh inputs
					</button>
					<button
						type="button"
						className="button"
						onClick={() => {
							version.current++;
							setConsent(false);
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
