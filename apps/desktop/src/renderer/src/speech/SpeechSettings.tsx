import { Schema } from "effect";
import { useEffect, useState } from "react";
import {
	type SpeechSettings,
	SpeechSettingsReply,
	type SpeechSettingsView,
} from "../../../shared/speech";
import { Group, Row } from "../ui/Form";

export function SpeechSettingsPanel(): React.JSX.Element | null {
	const [view, setView] = useState<SpeechSettingsView>();
	const [draft, setDraft] = useState<SpeechSettings>({
		version: 1,
		speakAnswers: false,
	});
	const [sttKey, setSttKey] = useState("");
	const [ttsKey, setTtsKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [savedSettings, setSavedSettings] = useState<SpeechSettings>();
	const saved = savedSettings === draft && !sttKey && !ttsKey;
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
	if (!window.quakeSpeech) return null;
	const save = async () => {
		setBusy(true);
		setError("");
		setSavedSettings(undefined);
		try {
			const raw = await window.quakeSpeech?.request({
				_tag: "Save",
				settings: draft,
				...(sttKey ? { sttKey } : {}),
				...(ttsKey ? { ttsKey } : {}),
			});
			const reply = Schema.decodeUnknownSync(SpeechSettingsReply)(raw);
			if (reply._tag === "rejected") setError(reply.code);
			else {
				setView(reply.view);
				setDraft(reply.view.settings);
				setSavedSettings(reply.view.settings);
			}
		} catch {
			setError("Speech settings couldn't be saved.");
		} finally {
			setSttKey("");
			setTtsKey("");
			setBusy(false);
		}
	};
	return (
		<Group title="Speech">
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
				hint="DashScope streaming ASR. Speech credentials are separate from chat."
			>
				<select
					aria-label="Recognition provider"
					value={draft.stt ? "dashscope" : "disabled"}
					disabled={busy || !view}
					onChange={(e) => {
						setSavedSettings(undefined);
						setDraft({
							...draft,
							stt:
								e.target.value === "disabled"
									? undefined
									: { workspace: "", region: "ap-southeast-1" },
						});
					}}
				>
					<option value="disabled">Disabled</option>
					<option value="dashscope">DashScope</option>
				</select>
			</Row>
			{draft.stt ? (
				<>
					<Row label="ASR workspace">
						<input
							aria-label="ASR workspace"
							value={draft.stt.workspace}
							disabled={busy}
							onChange={(e) =>
								setDraft({
									...draft,
									stt: {
										...draft.stt,
										workspace: e.target.value,
										region: draft.stt?.region ?? "ap-southeast-1",
									},
								})
							}
						/>
					</Row>
					<Row label="ASR region">
						<select
							aria-label="ASR region"
							value={draft.stt.region}
							disabled={busy}
							onChange={(e) =>
								setDraft({
									...draft,
									stt: {
										workspace: draft.stt?.workspace ?? "",
										region:
											e.target.value === "cn-beijing"
												? "cn-beijing"
												: "ap-southeast-1",
									},
								})
							}
						>
							<option value="ap-southeast-1">Singapore</option>
							<option value="cn-beijing">Beijing</option>
						</select>
					</Row>
					<Row
						label="ASR API key"
						hint={
							view?.sttCredential
								? "Key stored. Leave blank to keep it for this workspace and region."
								: "A region-matching key is required."
						}
					>
						<input
							aria-label="ASR API key"
							type="password"
							autoComplete="new-password"
							value={sttKey}
							disabled={busy}
							onChange={(e) => setSttKey(e.target.value)}
						/>
					</Row>
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
					onChange={(e) =>
						setDraft({
							...draft,
							tts:
								e.target.value === "openai"
									? { provider: "openai", language: "en", voice: "marin" }
									: e.target.value === "dashscope"
										? {
												provider: "dashscope",
												workspace: "",
												region: "ap-southeast-1",
												language: "en",
												voice: "longanlingxin_v3.1",
											}
										: undefined,
						})
					}
				>
					<option value="disabled">Disabled</option>
					<option value="openai">OpenAI Speech API</option>
					<option value="dashscope">DashScope</option>
				</select>
			</Row>
			{draft.tts ? (
				<>
					{draft.tts.provider === "openai" ? (
						<p>
							Compatibility model gpt-4o-mini-tts. This route disables on
							January 6, 2027.
						</p>
					) : (
						<>
							<Row label="TTS workspace">
								<input
									aria-label="TTS workspace"
									value={draft.tts.workspace}
									disabled={busy}
									onChange={(e) => {
										if (draft.tts?.provider === "dashscope")
											setDraft({
												...draft,
												tts: { ...draft.tts, workspace: e.target.value },
											});
									}}
								/>
							</Row>
							<Row label="TTS region">
								<select
									aria-label="TTS region"
									value={draft.tts.region}
									disabled={busy}
									onChange={(e) => {
										if (draft.tts?.provider === "dashscope")
											setDraft({
												...draft,
												tts: {
													...draft.tts,
													region:
														e.target.value === "cn-beijing"
															? "cn-beijing"
															: "ap-southeast-1",
												},
											});
									}}
								>
									<option value="ap-southeast-1">Singapore</option>
									<option value="cn-beijing">Beijing</option>
								</select>
							</Row>
						</>
					)}
					<Row label="Speech language">
						<select
							aria-label="Speech language"
							value={draft.tts.language}
							disabled={busy}
							onChange={(e) => {
								if (draft.tts)
									setDraft({
										...draft,
										tts: { ...draft.tts, language: e.target.value },
									});
							}}
						>
							{["en", "zh", "ja", "ko", "de", "fr", "es", "it"].map(
								(language) => (
									<option key={language} value={language}>
										{language}
									</option>
								),
							)}
						</select>
					</Row>
					<Row
						label="TTS API key"
						hint={
							view?.ttsCredential
								? "Key stored. Leave blank to keep it for this provider and workspace."
								: "A speech API key is required."
						}
					>
						<input
							aria-label="TTS API key"
							type="password"
							autoComplete="new-password"
							value={ttsKey}
							disabled={busy}
							onChange={(e) => setTtsKey(e.target.value)}
						/>
					</Row>
				</>
			) : null}
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
				<button
					type="button"
					className="button"
					disabled={busy || !view}
					onClick={() => void save()}
				>
					{busy ? "Saving…" : "Save speech settings"}
				</button>
				{saved ? <span role="status">Speech settings saved.</span> : null}
			</Row>
		</Group>
	);
}
