import { useId, useState } from "react";
import type { RuntimeConnectionView } from "../../../../../../../packages/edge/src/agent-http/runtime-contracts";
import { isRuntimeBaseURL } from "../../../../../../../packages/edge/src/agent-http/runtime-invariants";
import {
	type ConnectionDraft,
	canSaveConnection,
	endpointCredentialRequired,
} from "./connection-draft";
import t from "./strings.json";

export function ConnectionForm({
	existing,
	busy,
	onSave,
	onCancel,
}: {
	readonly existing: RuntimeConnectionView | undefined;
	readonly busy: boolean;
	readonly onSave: (draft: ConnectionDraft) => Promise<boolean>;
	readonly onCancel: () => void;
}) {
	const hintId = useId();
	const [draft, setDraft] = useState<ConnectionDraft>({
		name: existing?.name ?? "",
		kind: existing?.kind ?? "openclaw",
		baseURL: existing?.baseURL ?? "",
		credential: "",
		clearCredential: false,
	});
	const credentialRequired = endpointCredentialRequired(draft, existing);
	const invalidURL = draft.baseURL !== "" && !isRuntimeBaseURL(draft.baseURL);
	return (
		<form
			className="agent-http-form"
			onSubmit={(event) => {
				event.preventDefault();
				if (busy || !canSaveConnection(draft, existing)) return;
				// Drop the secret from controlled input before crossing the IPC boundary.
				setDraft((current) => ({ ...current, credential: "" }));
				void onSave(draft);
			}}
		>
			<fieldset disabled={busy}>
				<label className="mc-field">
					{t.name}
					<input
						required
						maxLength={120}
						value={draft.name}
						onChange={(event) =>
							setDraft({ ...draft, name: event.target.value })
						}
					/>
				</label>
				<label className="mc-field">
					{t.kind}
					<select
						value={draft.kind}
						onChange={(event) =>
							setDraft({
								...draft,
								kind: event.target.value === "hermes" ? "hermes" : "openclaw",
							})
						}
					>
						<option value="openclaw">OpenClaw</option>
						<option value="hermes">Hermes</option>
					</select>
				</label>
				<label className="mc-field">
					{t.endpoint}
					<input
						type="url"
						required
						maxLength={4096}
						autoCapitalize="none"
						spellCheck={false}
						value={draft.baseURL}
						aria-invalid={invalidURL}
						aria-describedby={`${hintId}-endpoint`}
						onChange={(event) =>
							setDraft({ ...draft, baseURL: event.target.value })
						}
						placeholder="http://localhost:8000/"
					/>
					<span id={`${hintId}-endpoint`} className="cw-field-hint">
						{invalidURL ? t.invalidEndpoint : t.endpointHint}
					</span>
				</label>
				<label className="mc-field">
					{t.credential}
					<input
						type="password"
						maxLength={16384}
						autoCapitalize="none"
						autoComplete="off"
						spellCheck={false}
						value={draft.credential}
						disabled={draft.clearCredential}
						aria-describedby={`${hintId}-credential`}
						onChange={(event) =>
							setDraft({ ...draft, credential: event.target.value })
						}
					/>
					<span id={`${hintId}-credential`} className="cw-field-hint">
						{existing?.credentialAvailable
							? t.credentialHint
							: t.credentialEmptyHint}
					</span>
				</label>
				{existing?.credentialAvailable && (
					<label className="cw-check">
						<input
							type="checkbox"
							checked={draft.clearCredential}
							onChange={(event) =>
								setDraft({
									...draft,
									clearCredential: event.target.checked,
									credential: "",
								})
							}
						/>
						{t.clearCredential}
					</label>
				)}
				{credentialRequired && (
					<p role="status" className="cw-notice">
						{t.changedEndpoint}
					</p>
				)}
				<div className="cw-dialog-actions">
					<span className="cw-spacer" />
					<button type="button" className="mc-button" onClick={onCancel}>
						{t.cancel}
					</button>
					<button
						type="submit"
						className="mc-button"
						data-primary
						disabled={!canSaveConnection(draft, existing)}
					>
						{busy ? t.busy : t.save}
					</button>
				</div>
			</fieldset>
		</form>
	);
}
