import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	AZURE_VOICES,
	azureVoice,
} from "../../../../../../packages/edge/src/ai/speech/speech-catalog";
import { OPENAI_VOICES } from "../../../../../../packages/edge/src/ai/speech/speech-contracts";
import {
	type MicrophoneIdentity,
	normalizeMicrophone,
	recoverMicrophone,
	type SpeechSettings,
	SpeechSettingsReply,
	type SpeechSettingsView,
	SttSettings,
	TtsSettings,
} from "../../../shared/speech";
import { useAppLocale } from "../i18n";
import { Group, Row } from "../ui/Form";
import {
	canReuseSpeechCredential,
	speechDraftError,
} from "./speech-settings-draft";

export function SpeechSettingsPanel(): React.JSX.Element | null {
	const [view, setView] = useState<SpeechSettingsView>();
	const [draft, setDraft] = useState<SpeechSettings>({
		version: 1,
		speakAnswers: false,
	});
	const [sttKey, setSttKey] = useState("");
	const [ttsKey, setTtsKey] = useState("");
	const [sttXfy, setSttXfy] = useState({
		appId: "",
		apiKey: "",
		apiSecret: "",
	});
	const [ttsXfy, setTtsXfy] = useState({
		appId: "",
		apiKey: "",
		apiSecret: "",
	});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [savedSettings, setSavedSettings] = useState<SpeechSettings>();
	const saved =
		savedSettings === draft &&
		!sttKey &&
		!ttsKey &&
		!Object.values(sttXfy).some(Boolean) &&
		!Object.values(ttsXfy).some(Boolean);
	const [loading, setLoading] = useState<Promise<unknown>>();
	useEffect(() => {
		setLoading(window.quakeSpeech?.request({ _tag: "Get" }));
	}, []);
	useEffect(() => {
		let live = true;
		if (loading)
			void loading
				.then((raw) => {
					const reply = Schema.decodeUnknownSync(SpeechSettingsReply)(raw);
					if (!live) return;
					if (reply._tag === "success") {
						setView(reply.view);
						setDraft(reply.view.settings);
					} else setError(reply.code);
				})
				.catch(() => {
					if (live) setError("Speech settings couldn't be loaded.");
				});
		return () => {
			live = false;
		};
	}, [loading]);
	const request = {
		_tag: "Save" as const,
		settings: draft,
		...(sttKey ? { sttKey } : {}),
		...(ttsKey ? { ttsKey } : {}),
		...(Object.values(sttXfy).some(Boolean) ? { sttXfy } : {}),
		...(Object.values(ttsXfy).some(Boolean) ? { ttsXfy } : {}),
	};
	const draftError = view ? speechDraftError(request, view) : "";
	if (!window.quakeSpeech) return null;
	const save = async () => {
		if (!view || draftError || busy) return;
		setBusy(true);
		setError("");
		setSavedSettings(undefined);
		try {
			const raw = await window.quakeSpeech?.request(request);
			const reply = Schema.decodeUnknownSync(SpeechSettingsReply)(raw);
			if (reply._tag === "rejected") setError(reply.code);
			else {
				setView(reply.view);
				setDraft(reply.view.settings);
				setSavedSettings(reply.view.settings);
				setSttKey("");
				setTtsKey("");
				setSttXfy({ appId: "", apiKey: "", apiSecret: "" });
				setTtsXfy({ appId: "", apiKey: "", apiSecret: "" });
			}
		} catch {
			setError("Speech settings couldn't be saved.");
		} finally {
			setBusy(false);
		}
	};
	return (
		<Group title="Speech">
			<MicrophonePicker
				value={normalizeMicrophone(draft.defaultMic)}
				disabled={!view || busy}
				onChange={(defaultMic) => setDraft({ ...draft, defaultMic })}
			/>
			{error ? <p role="alert">{error}</p> : null}
			{error && !view ? (
				<>
					<button
						type="button"
						className="button"
						onClick={() => {
							setError("");
							setLoading(window.quakeSpeech?.request({ _tag: "Get" }));
						}}
					>
						Retry loading speech settings
					</button>
					{error === "AI.PROVIDER.CONFIG_INVALID" ? (
						<button
							type="button"
							className="button"
							onClick={() => {
								const settings: SpeechSettings = {
									version: 1,
									speakAnswers: false,
								};
								setDraft(settings);
								setView({
									settings,
									sttCredential: false,
									ttsCredential: false,
								});
								setError(
									"The saved speech settings couldn't be read. Saving will replace them. Enter new keys to enable speech.",
								);
							}}
						>
							Replace invalid speech settings
						</button>
					) : null}
				</>
			) : null}
			{!view && !error ? <p role="status">Loading speech settings…</p> : null}
			<Row
				label="Recognition"
				hint="Speech credentials are separate from chat."
			>
				<select
					aria-label="Recognition provider"
					value={draft.stt ? (draft.stt.provider ?? "dashscope") : "disabled"}
					disabled={busy || !view}
					onChange={(e) => {
						setDraft({ ...draft, stt: initialStt(e.target.value) });
						setSttKey("");
						setSttXfy({ appId: "", apiKey: "", apiSecret: "" });
					}}
				>
					<option value="disabled">Disabled</option>
					<option value="dashscope">DashScope</option>
					<option value="openai">OpenAI</option>
					<option value="azure">Microsoft Azure</option>
					<option value="xfy">XFY</option>
				</select>
			</Row>
			{draft.stt ? (
				<>
					<ProviderFields
						config={draft.stt}
						kind="ASR"
						disabled={busy}
						onChange={(config) => setDraft({ ...draft, stt: config })}
					/>
					<SecretFields
						kind="ASR"
						xfy={draft.stt.provider === "xfy"}
						value={sttKey}
						onChange={setSttKey}
						bundle={sttXfy}
						onBundle={setSttXfy}
						stored={canReuseSpeechCredential(
							view?.settings.stt,
							draft.stt,
							view?.sttCredential ?? false,
						)}
						disabled={busy}
					/>
				</>
			) : null}
			<Row
				label="Synthesis"
				hint="Read Aloud and answer speech share this route."
			>
				<select
					aria-label="Synthesis provider"
					value={draft.tts?.provider ?? "disabled"}
					disabled={busy || !view}
					onChange={(e) => {
						setDraft({ ...draft, tts: initialTts(e.target.value) });
						setTtsKey("");
						setTtsXfy({ appId: "", apiKey: "", apiSecret: "" });
					}}
				>
					<option value="disabled">Disabled</option>
					<option value="openai">OpenAI Speech API</option>
					<option value="dashscope">DashScope</option>
					<option value="azure">Microsoft Azure</option>
					<option value="xfy">XFY</option>
					<option value="qwen-realtime">Qwen realtime, opt in</option>
				</select>
			</Row>
			{draft.tts ? (
				<>
					{draft.tts.provider === "openai" ? (
						<p>
							Compatibility model gpt-4o-mini-tts. This route disables on
							January 6, 2027.
						</p>
					) : null}
					<ProviderFields
						config={draft.tts}
						kind="TTS"
						disabled={busy}
						onChange={(config) => setDraft({ ...draft, tts: config })}
					/>
					<SecretFields
						kind="TTS"
						xfy={draft.tts.provider === "xfy"}
						value={ttsKey}
						onChange={setTtsKey}
						bundle={ttsXfy}
						onBundle={setTtsXfy}
						stored={canReuseSpeechCredential(
							view?.settings.tts,
							draft.tts,
							view?.ttsCredential ?? false,
						)}
						disabled={busy}
					/>
				</>
			) : null}
			<Row
				label="Region suggestions"
				hint="Uses the country you choose. Doesn't look up your location or activate speech."
			>
				<select
					aria-label="Region suggestions"
					disabled={busy || !view}
					value={draft.geographicSeed?.country ?? ""}
					onChange={(e) =>
						setDraft({
							...draft,
							geographicSeed: e.target.value
								? { country: e.target.value }
								: undefined,
						})
					}
				>
					<option value="">Off</option>
					<option value="CN">China</option>
					<option value="US">Outside China</option>
				</select>
				{view?.regionSuggestion ? (
					<p>
						{view.regionSuggestion.provider},{" "}
						{view.regionSuggestion.liveTranslationModel}
					</p>
				) : null}
			</Row>
			<Row label="Host voice tones">
				<input
					aria-label="Host voice tones"
					type="checkbox"
					checked={draft.hostTones === true}
					disabled={busy}
					onChange={(e) => setDraft({ ...draft, hostTones: e.target.checked })}
				/>
			</Row>
			<Row label="Speak answers">
				<input
					aria-label="Speak answers"
					type="checkbox"
					checked={draft.speakAnswers}
					disabled={busy || !draft.tts}
					onChange={(e) =>
						setDraft({ ...draft, speakAnswers: e.target.checked })
					}
				/>
			</Row>
			<Row label="Apply speech settings">
				{draftError ? (
					<p id="speech-draft-error" role="status">
						{draftError}
					</p>
				) : null}
				<button
					type="button"
					className="button"
					disabled={busy || !view || Boolean(draftError)}
					aria-describedby={draftError ? "speech-draft-error" : undefined}
					onClick={() => void save()}
				>
					{busy ? "Saving…" : "Save speech settings"}
				</button>
				{saved ? <span role="status">Speech settings saved.</span> : null}
			</Row>
		</Group>
	);
}

function initialStt(provider: string): SttSettings | undefined {
	switch (provider) {
		case "dashscope":
			return { provider, workspace: "", region: "ap-southeast-1" };
		case "openai":
			return { provider, language: "en" };
		case "azure":
			return { provider, region: "eastasia", language: "en-US" };
		case "xfy":
			return { provider, language: "zh_cn" };
		default:
			return undefined;
	}
}
function initialTts(provider: string): TtsSettings | undefined {
	switch (provider) {
		case "openai":
			return { provider, language: "en", voice: "marin" };
		case "dashscope":
			return {
				provider,
				workspace: "",
				region: "ap-southeast-1",
				language: "en",
				voice: "longanlingxin_v3.1",
			};
		case "azure":
			return {
				provider,
				region: "eastasia",
				language: "en-US",
				voice: azureVoice("en-US"),
			};
		case "xfy":
			return { provider, language: "zh_cn", voice: "aisxping" };
		case "qwen-realtime":
			return {
				provider,
				language: "en",
				voice: "Cherry",
				realtimeEnabled: true,
			};
		default:
			return undefined;
	}
}
type ProviderFieldProps = { disabled: boolean } & (
	| {
			kind: "ASR";
			config: SttSettings;
			onChange: (config: SttSettings) => void;
	  }
	| {
			kind: "TTS";
			config: TtsSettings;
			onChange: (config: TtsSettings) => void;
	  }
);
function ProviderFields(props: ProviderFieldProps) {
	const { config, disabled, kind } = props;
	const update = (patch: object) => {
		if (props.kind === "ASR") {
			const decoded = Schema.decodeUnknownEither(SttSettings)({
				...config,
				...patch,
			});
			if (decoded._tag === "Right") props.onChange(decoded.right);
		} else {
			const decoded = Schema.decodeUnknownEither(TtsSettings)({
				...config,
				...patch,
			});
			if (decoded._tag === "Right") props.onChange(decoded.right);
		}
	};
	const languages =
		config.provider === "azure"
			? Object.keys(AZURE_VOICES)
			: config.provider === "xfy"
				? ["zh_cn", "en_us"]
				: ["en", "zh", "ja", "ko", "de", "fr", "es", "it"];
	return (
		<>
			{"workspace" in config ? (
				<>
					<Row label={`${kind} workspace`}>
						<input
							aria-label={`${kind} workspace`}
							disabled={disabled}
							value={config.workspace}
							onChange={(e) => {
								if (props.kind === "ASR" && "workspace" in props.config)
									props.onChange({
										...props.config,
										workspace: e.target.value,
									});
								if (
									props.kind === "TTS" &&
									props.config.provider === "dashscope"
								)
									props.onChange({
										...props.config,
										workspace: e.target.value,
									});
							}}
						/>
					</Row>
					<Row label={`${kind} region`}>
						<select
							aria-label={`${kind} region`}
							disabled={disabled}
							value={config.region}
							onChange={(e) => update({ region: e.target.value })}
						>
							<option value="ap-southeast-1">Singapore</option>
							<option value="cn-beijing">Beijing</option>
						</select>
					</Row>
				</>
			) : null}
			{config.provider === "azure" ? (
				<Row label={`${kind} Azure region`}>
					<input
						aria-label={`${kind} Azure region`}
						disabled={disabled}
						value={config.region ?? "eastasia"}
						onChange={(e) => {
							if (props.kind === "ASR" && props.config.provider === "azure")
								props.onChange({ ...props.config, region: e.target.value });
							if (props.kind === "TTS" && props.config.provider === "azure")
								props.onChange({ ...props.config, region: e.target.value });
						}}
					/>
				</Row>
			) : null}
			{"language" in config ? (
				<Row
					label={kind === "TTS" ? "Speech language" : "Recognition language"}
				>
					<select
						aria-label={
							kind === "TTS" ? "Speech language" : "Recognition language"
						}
						disabled={disabled}
						value={config.language}
						onChange={(e) =>
							update({
								language: e.target.value,
								...(config.provider === "azure" && "voice" in config
									? { voice: azureVoice(e.target.value) }
									: {}),
							})
						}
					>
						{languages.map((l) => (
							<option key={l} value={l}>
								{l}
							</option>
						))}
					</select>
				</Row>
			) : null}
			{"voice" in config ? (
				<Row label="Voice">
					<select
						aria-label="Voice"
						disabled={disabled}
						value={config.voice}
						onChange={(e) => update({ voice: e.target.value })}
					>
						{(config.provider === "azure"
							? (AZURE_VOICES[config.language] ?? [])
							: config.provider === "openai"
								? OPENAI_VOICES
								: [config.voice]
						).map((v) => (
							<option key={v} value={v}>
								{v}
							</option>
						))}
					</select>
				</Row>
			) : null}
		</>
	);
}
type SecretBundle = { appId: string; apiKey: string; apiSecret: string };
function SecretFields({
	kind,
	xfy,
	value,
	onChange,
	bundle,
	onBundle,
	stored,
	disabled,
}: {
	kind: string;
	xfy: boolean;
	value: string;
	onChange: (s: string) => void;
	bundle: SecretBundle;
	onBundle: (b: SecretBundle) => void;
	stored: boolean;
	disabled: boolean;
}) {
	const hint = stored
		? "Credentials stored. Leave blank to keep them for this provider and region."
		: "Speech credentials are required.";
	return xfy ? (
		<>
			{(["appId", "apiKey", "apiSecret"] as const).map((field) => (
				<Row
					key={field}
					label={`${kind} XFY ${field}`}
					hint={field === "appId" ? hint : undefined}
				>
					<input
						aria-label={`${kind} XFY ${field}`}
						type="password"
						autoComplete="new-password"
						disabled={disabled}
						value={bundle[field]}
						onChange={(e) => onBundle({ ...bundle, [field]: e.target.value })}
					/>
				</Row>
			))}
		</>
	) : (
		<Row label={`${kind} API key`} hint={hint}>
			<input
				aria-label={`${kind} API key`}
				type="password"
				autoComplete="new-password"
				disabled={disabled}
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>
		</Row>
	);
}

/** Enumerates only. Permission and physical acquisition belong to capture. */
export function MicrophonePicker({
	value,
	onChange,
	disabled = false,
}: {
	value: MicrophoneIdentity | undefined;
	onChange: (value: MicrophoneIdentity) => void;
	disabled?: boolean;
}): React.JSX.Element {
	const { locale } = useAppLocale();
	const de = locale === "de";
	const [devices, setDevices] = useState<readonly MicrophoneIdentity[]>([]);
	const [error, setError] = useState(false);
	const version = useRef(0);
	const refresh = useCallback(async () => {
		const request = ++version.current;
		try {
			const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
				(d) => d.kind === "audioinput",
			);
			if (request !== version.current) return;
			setDevices(inputs);
			setError(false);
		} catch {
			if (request === version.current) {
				setDevices([]);
				setError(true);
			}
		}
	}, []);
	useEffect(() => {
		void refresh();
		const changed = () => {
			void refresh();
		};
		navigator.mediaDevices?.addEventListener("devicechange", changed);
		return () => {
			version.current++;
			navigator.mediaDevices?.removeEventListener("devicechange", changed);
		};
	}, [refresh]);
	const chosen = recoverMicrophone(value, devices);
	return (
		<Row label={de ? "Eingabemikrofon" : "Input Microphone"}>
			<select
				aria-label={de ? "Eingabemikrofon" : "Input Microphone"}
				disabled={disabled}
				value={chosen?.deviceId ?? ""}
				onFocus={() => {
					void refresh();
				}}
				onPointerDown={() => {
					void refresh();
				}}
				onChange={(event) => {
					const input = devices.find((d) => d.deviceId === event.target.value);
					if (input) {
						version.current++;
						onChange({
							deviceId: input.deviceId,
							label: input.label,
							groupId: input.groupId,
						});
					}
				}}
			>
				<option value="" disabled>
					{de ? "Mikrofon auswählen" : "Select Microphone"}
				</option>
				{devices.map((input, i) => (
					<option key={input.deviceId} value={input.deviceId}>
						{input.label ||
							(input.deviceId === "default"
								? de
									? "Systemstandard"
									: "System default"
								: `${de ? "Mikrofon" : "Microphone"} ${i + 1}`)}
					</option>
				))}
			</select>
			{error || (value && !chosen) ? (
				<p role="status">
					{de
						? "Das gespeicherte Mikrofon ist nicht verfügbar. Wähle ein Mikrofon aus."
						: "The saved microphone is unavailable. Select a microphone."}
				</p>
			) : null}
		</Row>
	);
}
/** Meetings save only the shared input field, preserving current provider settings. */
export function SharedMicrophonePicker(): React.JSX.Element {
	const [settings, setSettings] = useState<SpeechSettings>();
	const [error, setError] = useState("");
	useEffect(() => {
		let live = true;
		void window.quakeSpeech
			?.request({ _tag: "Get" })
			.then((raw) => {
				const reply = Schema.decodeUnknownSync(SpeechSettingsReply)(raw);
				if (live && reply._tag === "success") setSettings(reply.view.settings);
			})
			.catch(() => {
				if (live) setError("Microphone settings are unavailable");
			});
		return () => {
			live = false;
		};
	}, []);
	return (
		<>
			<MicrophonePicker
				value={normalizeMicrophone(settings?.defaultMic)}
				disabled={!settings}
				onChange={(microphone) => {
					void window.quakeSpeech
						?.request({ _tag: "SelectMicrophone", microphone })
						.then((raw) => {
							const reply = Schema.decodeUnknownSync(SpeechSettingsReply)(raw);
							if (reply._tag === "success") {
								setSettings(reply.view.settings);
								setError("");
							} else setError(reply.code);
						})
						.catch(() => setError("Microphone settings couldn't be saved"));
				}}
			/>
			{error ? <p role="alert">{error}</p> : null}
		</>
	);
}
