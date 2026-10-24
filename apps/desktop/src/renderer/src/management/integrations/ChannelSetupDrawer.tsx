import { useCallback, useEffect, useRef, useState } from "react";
import {
	credentialFields,
	maskSecret,
} from "../../../../../../../packages/edge/src/channels/channel-catalog";
import type {
	ChannelDescriptor,
	ChannelView,
	Pairing,
	QrSession,
} from "../../../../../../../packages/edge/src/channels/channel-contracts";
import { channelStrings as s } from "./strings";
import { useIntegrations } from "./useIntegrations";
export function ChannelSetupDrawer({
	descriptor,
	configured,
	onClose,
}: {
	readonly descriptor: ChannelDescriptor;
	readonly configured: ChannelView | undefined;
	readonly onClose: () => void;
}) {
	const { request, error, busy, setError } = useIntegrations();
	const [step, setStep] = useState(0);
	const [prepared, setPrepared] = useState(false);
	const [fields, setFields] = useState<Record<string, string>>({
		...configured?.publicFields,
		domain: configured?.publicFields.domain ?? "feishu",
	});
	const [qr, setQr] = useState<QrSession>();
	const [pairings, setPairings] = useState<readonly Pairing[]>([]);
	const [done, setDone] = useState(false);
	const dialog = useRef<HTMLDialogElement>(null);
	const session = useRef("");
	const closed = useRef(false);
	const approving = useRef(new Set<string>());
	const [pairingBusy, setPairingBusy] = useState("");
	const qrMode = descriptor.setupType === "qr_login";
	const hasPairing = descriptor.id === "feishu" || qrMode;
	const close = useCallback(() => {
		closed.current = true;
		if (session.current)
			void window.quakeIntegrations?.request({
				type: "channels.qr.cancel",
				session: session.current,
			});
		onClose();
	}, [onClose]);
	useEffect(() => {
		closed.current = false;
		dialog.current?.showModal();
		return () => {
			closed.current = true;
			if (session.current)
				void window.quakeIntegrations?.request({
					type: "channels.qr.cancel",
					session: session.current,
				});
		};
	}, []);
	useEffect(() => {
		if (qr?.state !== "pending" && qr?.state !== "ready") return;
		const timer = setInterval(async () => {
			const reply = await request({ type: "channels.qr.read", session: qr.id });
			if (!closed.current && reply?.type === "qr") setQr(reply.session);
		}, 750);
		return () => clearInterval(timer);
	}, [qr, request]);
	const refreshPairings = useCallback(async () => {
		const reply = await request({
			type: "channels.pairings",
			id: descriptor.id,
		});
		if (reply?.type === "pairings") setPairings(reply.pairings);
	}, [descriptor.id, request]);
	const startQr = async () => {
		setQr(undefined);
		const reply = await request({
			type: "channels.qr.start",
			id: descriptor.id,
		});
		if (reply?.type !== "qr") return;
		if (closed.current) {
			void window.quakeIntegrations?.request({
				type: "channels.qr.cancel",
				session: reply.session.id,
			});
			return;
		}
		session.current = reply.session.id;
		setQr(reply.session);
	};
	const names = [
		s.drawer.stepPrepare,
		s.drawer.stepCredentials,
		s.drawer.stepConfirm,
		s.drawer.stepDone,
	];
	return (
		<dialog
			ref={dialog}
			className="mc-dialog"
			aria-label={s.drawer.title.replace("{name}", descriptor.name)}
			onCancel={(event) => {
				event.preventDefault();
				close();
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					close();
				}
			}}
			onClick={(event) => {
				if (event.target === event.currentTarget && step === 3) close();
			}}
			style={{
				marginRight: 0,
				maxWidth: 540,
				width: "min(540px, 100vw)",
				maxHeight: "100vh",
			}}
		>
			<header className="mc-toolbar">
				<h2>{s.drawer.title.replace("{name}", descriptor.name)}</h2>
				<button
					className="mc-button"
					type="button"
					aria-label={s.drawer.close}
					onClick={close}
				>
					×
				</button>
			</header>
			<ol className="mc-toolbar" aria-label="Setup progress">
				{names.map((name, index) => (
					<li key={name} aria-current={step === index ? "step" : undefined}>
						{name}
					</li>
				))}
				{configured?.configured && hasPairing && (
					<li>
						<button
							className="mc-button"
							type="button"
							onClick={() => {
								setStep(4);
								void refreshPairings();
							}}
						>
							Pairing
						</button>
					</li>
				)}
			</ol>
			{error && <p role="alert">{error}</p>}
			{step === 0 && (
				<section className="mc-panel">
					<p>{descriptor.blurb}</p>
					{descriptor.platformUrl && (
						<button
							className="mc-button"
							type="button"
							onClick={() =>
								void request({ type: "channels.portal", id: descriptor.id })
							}
						>
							{s.drawer.openPlatform}
						</button>
					)}
					{descriptor.id === "openclaw-weixin" && (
						<p>{s.drawer.weixinDisclaimer}</p>
					)}
					{descriptor.id === "wecom" && <p>{s.drawer.wecomBotHint}</p>}
					{!qrMode && (
						<label>
							<input
								type="checkbox"
								checked={prepared}
								onChange={(event) => setPrepared(event.target.checked)}
							/>
							{s.drawer.preparedCheck}
						</label>
					)}
				</section>
			)}
			{step === 1 && (
				<section className="mc-panel">
					{qrMode ? (
						<>
							<p>
								{descriptor.id === "whatsapp"
									? s.drawer.qrHint.whatsapp
									: s.drawer.qrHint["openclaw-weixin"]}
							</p>
							{qr?.image ? (
								<img
									src={qr.image}
									width={220}
									height={220}
									alt={`${descriptor.name} login QR code`}
								/>
							) : (
								<p role="status">{s.drawer.qrWaiting}</p>
							)}
							{qr?.url && (
								<button
									className="mc-button"
									type="button"
									onClick={() =>
										void request({ type: "channels.qr.open", session: qr.id })
									}
								>
									{s.drawer.qrOpenLink}
								</button>
							)}
							<button
								className="mc-button"
								type="button"
								disabled={busy}
								onClick={() => void startQr()}
							>
								{s.drawer.qrRefresh}
							</button>
							<p role="status">{qr?.state}</p>
							<pre>{qr?.lines.join("\n")}</pre>
						</>
					) : (
						<>
							{descriptor.id === "feishu" && (
								<label className="mc-field">
									{s.drawer.domain}
									<select
										value={fields.domain}
										onChange={(event) =>
											setFields({ ...fields, domain: event.target.value })
										}
									>
										<option value="feishu">{s.drawer.feishuLabel}</option>
										<option value="lark">{s.drawer.larkLabel}</option>
									</select>
								</label>
							)}
							{credentialFields(descriptor.id).map((field) => (
								<label className="mc-field" key={field.key}>
									{field.label}
									<input
										autoComplete="off"
										type={field.secret ? "password" : "text"}
										value={fields[field.key] ?? ""}
										onChange={(event) =>
											setFields({ ...fields, [field.key]: event.target.value })
										}
										onPaste={(event) => {
											if (descriptor.id !== "qqbot" || field.key !== "appId")
												return;
											const parts = event.clipboardData
												.getData("text")
												.split(":");
											if (parts.length === 2) {
												event.preventDefault();
												setFields({
													...fields,
													appId: parts[0]?.trim() ?? "",
													clientSecret: parts[1]?.trim() ?? "",
												});
											}
										}}
									/>
								</label>
							))}
						</>
					)}
				</section>
			)}
			{step === 2 && (
				<section className="mc-panel">
					<p>{s.drawer.confirmHint}</p>
					<dl>
						<dt>Channel</dt>
						<dd>{descriptor.name}</dd>
						{credentialFields(descriptor.id).map((field) => (
							<div key={field.key}>
								<dt>{field.label}</dt>
								<dd>
									{field.secret
										? maskSecret(fields[field.key] ?? "")
										: fields[field.key]}
								</dd>
							</div>
						))}
						{descriptor.id === "feishu" && (
							<>
								<dt>{s.drawer.domain}</dt>
								<dd>{fields.domain}</dd>
							</>
						)}
						{qrMode && (
							<>
								<dt>QR login</dt>
								<dd>{qr?.state}</dd>
							</>
						)}
					</dl>
				</section>
			)}
			{step === 3 && (
				<section className="mc-empty">
					<h3>
						{done ? s.drawer.doneSuccess : "Channel configuration failed"}
					</h3>
					<p>Connection is verified by the runtime.</p>
				</section>
			)}
			{step === 4 && (
				<section className="mc-panel">
					<div className="mc-toolbar">
						<h3>Pairing</h3>
						<button
							className="mc-button"
							type="button"
							disabled={busy}
							onClick={() => void refreshPairings()}
						>
							Refresh
						</button>
					</div>
					{!pairings.length && (
						<p className="mc-empty">No pending pairing requests</p>
					)}
					{pairings.map((pairing) => (
						<article className="mc-card" key={pairing.code}>
							<strong>{pairing.code}</strong>
							<p>
								{pairing.sender} ·{" "}
								{Math.max(
									0,
									Math.floor((Date.now() - pairing.createdAt) / 60000),
								)}{" "}
								min
							</p>
							<button
								className="mc-button"
								type="button"
								disabled={!!pairingBusy}
								onClick={async () => {
									if (approving.current.has(pairing.code)) return;
									approving.current.add(pairing.code);
									setPairingBusy(pairing.code);
									const reply = await request({
										type: "channels.approve",
										id: descriptor.id,
										code: pairing.code,
									});
									if (reply?.type === "pairings") setPairings(reply.pairings);
									approving.current.delete(pairing.code);
									setPairingBusy("");
								}}
							>
								Approve
							</button>
						</article>
					))}
				</section>
			)}
			<footer className="mc-toolbar">
				{step > 0 && step < 3 && (
					<button
						className="mc-button"
						type="button"
						disabled={busy}
						onClick={() => setStep(step - 1)}
					>
						{s.drawer.prev}
					</button>
				)}
				{step < 2 && (
					<button
						className="mc-button"
						data-primary
						type="button"
						disabled={
							busy ||
							(step === 0 && !qrMode && !prepared) ||
							(step === 1 && qrMode && qr?.state !== "confirmed")
						}
						onClick={() => {
							if (
								step === 1 &&
								!qrMode &&
								credentialFields(descriptor.id).some(
									(f) => !fields[f.key]?.trim(),
								)
							) {
								setError("Complete the required credentials");
								return;
							}
							setStep(step + 1);
							if (step === 0 && qrMode) void startQr();
						}}
					>
						{s.drawer.next}
					</button>
				)}
				{step === 2 && (
					<button
						className="mc-button"
						data-primary
						type="button"
						disabled={busy}
						onClick={async () => {
							const reply = await request({
								type: "channels.save",
								id: descriptor.id,
								fields,
								session: qr?.id ?? "",
							});
							if (reply?.type === "channels") {
								setDone(true);
								setFields({});
								setStep(3);
							}
						}}
					>
						{s.drawer.finish}
					</button>
				)}
				{step >= 3 && (
					<button className="mc-button" type="button" onClick={close}>
						{s.drawer.close}
					</button>
				)}
			</footer>
		</dialog>
	);
}
