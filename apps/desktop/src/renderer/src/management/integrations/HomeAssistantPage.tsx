import { Schema } from "effect";
import { useCallback, useEffect, useState } from "react";
import {
	HaKey,
	type HaSnapshot,
} from "../../../../../../../packages/edge/src/home-assistant/ha-contracts";
import {
	groupEntities,
	requiredServiceData,
	tileLines,
} from "../../../../../../../packages/edge/src/home-assistant/ha-invariants";
import type { KeyTarget } from "../../../../shared/integrations";
import { haStrings as s } from "./strings";
import { useHaLive } from "./useHaLive";
import { useIntegrations } from "./useIntegrations";

const blankKey: HaKey = {
	entity_id: "",
	service: "",
	service_data: {},
	custom_display_type: "default",
	custom_display_settings: { fontSize: 40 },
	custom_display_detail: [],
};
export function HomeAssistantPage() {
	const { request, error, busy } = useIntegrations();
	const [snapshot, setSnapshot] = useState<HaSnapshot>();
	const [origin, setOrigin] = useState("");
	const [token, setToken] = useState("");
	const [connecting, setConnecting] = useState(false);
	const [group, setGroup] = useState<"room" | "entity">("room");
	const [allowlist, setAllowlist] = useState<readonly string[]>([]);
	const [targets, setTargets] = useState<readonly KeyTarget[]>([]);
	const [targetId, setTargetId] = useState("");
	const [key, setKey] = useState<HaKey>(blankKey);
	const [notice, setNotice] = useState("");
	const live = useHaLive();
	const refresh = useCallback(async () => {
		const reply = await request({ type: "ha.read" });
		if (reply?.type === "ha") {
			setSnapshot(reply.snapshot);
			setOrigin(reply.snapshot.origin);
			setAllowlist(reply.snapshot.allowlist);
		}
	}, [request]);
	const refreshTargets = useCallback(async () => {
		const reply = await request({ type: "ha.targets" });
		if (reply?.type === "targets") setTargets(reply.targets);
	}, [request]);
	useEffect(() => {
		void refresh();
		void refreshTargets();
	}, [refresh, refreshTargets]);
	useEffect(() => {
		if (snapshot?.state !== "Connected" || live.connected) return;
		void request({ type: "ha.read" }).then((reply) => {
			if (reply?.type === "ha") setSnapshot(reply.snapshot);
		});
	}, [snapshot?.state, live.connected, request]);
	const entities = snapshot?.entities ?? [];
	const groups = groupEntities(entities, group);
	const entity = entities.find((e) => e.entity_id === key.entity_id);
	const services = (snapshot?.services ?? []).filter(
		(service) => service.domain === key.entity_id.split(".")[0],
	);
	const service = services.find((service) => service.service === key.service);
	const target = targets.find(
		(t) => `${t.profileId}/${t.pageId}/${t.keyCode}` === targetId,
	);
	const status = connecting
		? "Connecting"
		: (snapshot?.state ?? "Disconnected");
	const connect = async () => {
		setConnecting(true);
		setNotice("");
		await request({ type: "ha.connect", origin, token });
		setToken("");
		await refresh();
		setConnecting(false);
	};
	const previewEntity =
		live.states.find((e) => e.entity_id === key.entity_id) ?? entity;
	return (
		<section className="mc-panel" aria-label="Home Assistant Settings">
			<header className="mc-toolbar">
				<div>
					<h2>Home Assistant</h2>
					<p>Home Assistant Settings</p>
				</div>
				<span className="mc-badge" role="status">
					{status}
				</span>
			</header>
			{error && <p role="alert">{error}</p>}
			{notice && <p role="status">{notice}</p>}
			<section className="mc-card" aria-label={s.connectionStatus}>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void connect();
					}}
				>
					<div className="mc-grid">
						<label className="mc-field">
							{s.serverAddr}
							<input
								type="url"
								value={origin}
								placeholder="http(s)://"
								required
								onChange={(event) => setOrigin(event.target.value)}
							/>
						</label>
						<label className="mc-field">
							{s.apiKey}
							<input
								type="password"
								autoComplete="new-password"
								value={token}
								placeholder={snapshot?.tokenMask ?? ""}
								onChange={(event) => setToken(event.target.value)}
							/>
							{snapshot?.tokenMask && <span>{snapshot.tokenMask}</span>}
						</label>
					</div>
					<div className="mc-toolbar">
						<span>
							{s.connectionStatus}: {status}
						</span>
						<button
							className="mc-button"
							data-primary
							type="submit"
							disabled={busy || connecting}
						>
							{snapshot?.tokenMask ? s.reconnect : s.connect}
						</button>
					</div>
				</form>
				{snapshot?.reason && <p role="status">{snapshot.reason}</p>}
				{snapshot?.certificate && (
					<section className="mc-panel" aria-label="Certificate consent">
						<h3>Certificate requires consent</h3>
						<p>{snapshot.certificate.origin}</p>
						<code style={{ overflowWrap: "anywhere" }}>
							{snapshot.certificate.fingerprint}
						</code>
						<button
							className="mc-button"
							type="button"
							disabled={busy}
							onClick={async () => {
								if (!snapshot.certificate) return;
								const reply = await request({
									type: "ha.trust",
									certificate: snapshot.certificate,
								});
								if (reply?.type === "ha") setSnapshot(reply.snapshot);
							}}
						>
							Trust this certificate for this server
						</button>
					</section>
				)}
				{snapshot?.trusted.map((cert) => (
					<div className="mc-toolbar" key={cert.origin}>
						<p role="status">
							Certificate exception: {cert.origin}
							<br />
							<code style={{ overflowWrap: "anywhere" }}>
								{cert.fingerprint}
							</code>
						</p>
						<button
							className="mc-button"
							type="button"
							disabled={busy}
							onClick={async () => {
								const reply = await request({
									type: "ha.revoke",
									origin: cert.origin,
								});
								if (reply?.type === "ha") setSnapshot(reply.snapshot);
							}}
						>
							Revoke trust
						</button>
					</div>
				))}
			</section>
			<fieldset className="mc-tabs">
				<legend>Entity grouping</legend>
				{(["room", "entity"] as const).map((by) => (
					<button
						key={by}
						type="button"
						aria-pressed={group === by}
						onClick={() => setGroup(by)}
					>
						{by === "room" ? s.selectByRoom : s.selectByEntity}
					</button>
				))}
			</fieldset>
			<div className="mc-split">
				<main className="mc-panel">
					<section className="mc-card" aria-label="Key configuration">
						<h3>Key configuration</h3>
						<label className="mc-field">
							Profile key
							<select
								value={targetId}
								onFocus={() => void refreshTargets()}
								onChange={(event) => {
									setTargetId(event.target.value);
									const selected = targets.find(
										(t) =>
											`${t.profileId}/${t.pageId}/${t.keyCode}` ===
											event.target.value,
									);
									setKey(selected?.key ?? blankKey);
								}}
							>
								<option value="">Select a profile key</option>
								{targets.map((t) => (
									<option
										key={`${t.profileId}/${t.pageId}/${t.keyCode}`}
										value={`${t.profileId}/${t.pageId}/${t.keyCode}`}
									>
										{t.label}
									</option>
								))}
							</select>
						</label>
						<fieldset disabled={snapshot?.state !== "Connected" || busy}>
							<legend>{s.selectEntity}</legend>
							<label className="mc-field">
								{s.selectEntity}
								<select
									value={key.entity_id}
									onChange={(event) =>
										setKey({ ...blankKey, entity_id: event.target.value })
									}
								>
									<option value="">{s.selectEntity}</option>
									{groups.map((group) => (
										<optgroup key={group.name} label={group.name}>
											{group.entities.map((e) => (
												<option key={e.entity_id} value={e.entity_id}>
													{typeof e.attributes.friendly_name === "string"
														? e.attributes.friendly_name
														: e.entity_id}
												</option>
											))}
										</optgroup>
									))}
								</select>
							</label>
							<label className="mc-field">
								{s.selectServiceAction}
								<select
									value={key.service}
									onChange={(event) => {
										const next = services.find(
											(s) => s.service === event.target.value,
										);
										setKey({
											...key,
											service: event.target.value,
											service_data: next ? requiredServiceData(next) : {},
										});
									}}
								>
									<option value="">{s.selectServiceAction}</option>
									{services.map((service) => (
										<option key={service.service} value={service.service}>
											{service.name}
										</option>
									))}
								</select>
							</label>
							{service?.fields.map((field) => (
								<label
									className="mc-field"
									key={field.name}
									htmlFor={`ha-field-${field.name}`}
								>
									{field.label}
									{field.required ? " *" : ""}
									{field.type === "boolean" ? (
										<input
											id={`ha-field-${field.name}`}
											type="checkbox"
											checked={key.service_data[field.name] === true}
											onChange={(event) =>
												setKey({
													...key,
													service_data: {
														...key.service_data,
														[field.name]: event.target.checked,
													},
												})
											}
										/>
									) : field.type === "select" ? (
										<select
											id={`ha-field-${field.name}`}
											value={String(key.service_data[field.name] ?? "")}
											onChange={(event) =>
												setKey({
													...key,
													service_data: {
														...key.service_data,
														[field.name]: event.target.value,
													},
												})
											}
										>
											<option value="">Not set</option>
											{field.options.map((option) => (
												<option key={option}>{option}</option>
											))}
										</select>
									) : (
										<input
											id={`ha-field-${field.name}`}
											type={field.type === "number" ? "number" : "text"}
											{...(field.type === "number"
												? { min: field.min, max: field.max }
												: {})}
											value={String(key.service_data[field.name] ?? "")}
											onChange={(event) => {
												const value = event.target.value;
												const data = { ...key.service_data };
												if (value === "") delete data[field.name];
												else
													data[field.name] =
														field.type === "number" ? Number(value) : value;
												setKey({ ...key, service_data: data });
											}}
										/>
									)}
								</label>
							))}
							<fieldset>
								<legend>{s.displayInfo}</legend>
								{(["icon", "default", "custom"] as const).map((mode) => (
									<label key={mode}>
										<input
											type="radio"
											name="ha-display-mode"
											value={mode}
											checked={key.custom_display_type === mode}
											onChange={() =>
												setKey({ ...key, custom_display_type: mode })
											}
										/>
										{mode === "icon"
											? s.iconDisplay
											: mode === "default"
												? s.defaultDisplay
												: s.customDisplay}
									</label>
								))}
							</fieldset>
							{key.custom_display_type === "custom" && (
								<>
									<label className="mc-field">
										{s.fontSize} · {key.custom_display_settings.fontSize}px
										<input
											type="range"
											min={10}
											max={70}
											value={key.custom_display_settings.fontSize}
											onChange={(event) =>
												setKey({
													...key,
													custom_display_settings: {
														fontSize: Number(event.target.value),
													},
												})
											}
										/>
									</label>
									<fieldset>
										<legend>{s.displayInfo}</legend>
										{["state", ...Object.keys(entity?.attributes ?? {})].map(
											(name) => {
												const item = key.custom_display_detail.find(
													(i) => i.displayItemKey === name,
												);
												return (
													<div key={name}>
														<label>
															<input
																type="checkbox"
																checked={!!item}
																onChange={(event) =>
																	setKey({
																		...key,
																		custom_display_detail: event.target.checked
																			? [
																					...key.custom_display_detail,
																					{
																						displayItemKey: name,
																						displayAlias: "",
																					},
																				]
																			: key.custom_display_detail.filter(
																					(i) => i.displayItemKey !== name,
																				),
																	})
																}
															/>
															{name}
														</label>
														{item && (
															<label className="mc-field">
																{s.displayAlias}
																<input
																	aria-label={`${s.displayAlias} ${name}`}
																	value={item.displayAlias}
																	onChange={(event) =>
																		setKey({
																			...key,
																			custom_display_detail:
																				key.custom_display_detail.map((i) =>
																					i.displayItemKey === name
																						? {
																								...i,
																								displayAlias:
																									event.target.value,
																							}
																						: i,
																				),
																		})
																	}
																/>
															</label>
														)}
													</div>
												);
											},
										)}
									</fieldset>
								</>
							)}
							<button
								className="mc-button"
								data-primary
								type="button"
								disabled={!target || !key.entity_id || !key.service}
								onClick={async () => {
									if (!target) return;
									const decoded = Schema.decodeUnknownEither(HaKey)(key);
									if (decoded._tag === "Left") return;
									const reply = await request({
										type: "ha.key",
										target: {
											profileId: target.profileId,
											pageId: target.pageId,
											keyCode: target.keyCode,
										},
										key: decoded.right,
									});
									if (reply?.type === "ok") {
										setNotice("Saved");
										void refreshTargets();
									}
								}}
							>
								Save
							</button>
						</fieldset>
					</section>
					{key.entity_id && (
						<section className="mc-card" aria-label="Key preview">
							<h3>Key preview</h3>
							<div
								style={{
									display: "grid",
									placeContent: "center",
									minHeight: 180,
									textAlign: "center",
									fontSize: key.custom_display_settings.fontSize,
									fontWeight: 800,
									color: "white",
									background: "#15191f",
									borderRadius: 16,
								}}
							>
								{key.custom_display_type === "icon" ? (
									<span role="img" aria-label="Icon">
										⌂
									</span>
								) : (
									tileLines(
										key,
										previewEntity,
										status === "Connected" && live.connected,
									).map((line, index) => (
										<div
											key={
												key.custom_display_detail[index]?.displayItemKey ??
												"state"
											}
										>
											{line}
										</div>
									))
								)}
							</div>
						</section>
					)}
				</main>
				<aside className="mc-aside" aria-label={s.configableEntity}>
					<h3>{s.configableEntity}</h3>
					<p>{allowlist.length} entities selected</p>
					{!entities.length && (
						<div className="mc-empty">Connect to list entities</div>
					)}
					{groups.map((group) => (
						<fieldset key={group.name}>
							<legend>
								<label>
									<input
										type="checkbox"
										checked={group.entities.every((e) =>
											allowlist.includes(e.entity_id),
										)}
										ref={(element) => {
											if (element)
												element.indeterminate =
													group.entities.some((e) =>
														allowlist.includes(e.entity_id),
													) &&
													!group.entities.every((e) =>
														allowlist.includes(e.entity_id),
													);
										}}
										onChange={(event) =>
											setAllowlist(
												event.target.checked
													? [
															...new Set([
																...allowlist,
																...group.entities.map((e) => e.entity_id),
															]),
														]
													: allowlist.filter(
															(id) =>
																!group.entities.some((e) => e.entity_id === id),
														),
											)
										}
									/>
									{group.name}
								</label>
							</legend>
							{group.entities.map((entity) => (
								<label key={entity.entity_id} style={{ display: "block" }}>
									<input
										type="checkbox"
										checked={allowlist.includes(entity.entity_id)}
										onChange={(event) =>
											setAllowlist(
												event.target.checked
													? [...allowlist, entity.entity_id]
													: allowlist.filter((id) => id !== entity.entity_id),
											)
										}
									/>
									{typeof entity.attributes.friendly_name === "string"
										? entity.attributes.friendly_name
										: entity.entity_id}
								</label>
							))}
						</fieldset>
					))}
					<button
						className="mc-button"
						data-primary
						type="button"
						disabled={busy || !entities.length}
						onClick={async () => {
							const reply = await request({
								type: "ha.allowlist",
								ids: allowlist,
							});
							if (reply?.type === "ha") {
								setSnapshot(reply.snapshot);
								setAllowlist(reply.snapshot.allowlist);
								setNotice("Saved");
							}
						}}
					>
						Save
					</button>
				</aside>
			</div>
		</section>
	);
}
