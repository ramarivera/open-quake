import { Option, Schema } from "effect";
import { useEffect, useState } from "react";
import {
	BUILTIN_PROFILES,
	isBuiltinProfile,
	profileText,
} from "../../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	Profile,
	ProfileEnvelope,
} from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import {
	managerState,
	truncateProfileName,
	weightedNameLength,
} from "../../../../../../packages/device/src/profiles/profile-manager-invariants.js";
import type {
	ProfileDelivery,
	ProfileRequest,
	ProfileView,
} from "../../../shared/profile-manager";
import "./profiles.css";

const decode = (view: ProfileView): ProfileEnvelope =>
	Schema.decodeUnknownSync(ProfileEnvelope)(view.envelope);
export function ProfilePreview({
	profile,
}: {
	profile: Profile;
}): React.JSX.Element {
	return (
		<div
			className="profile-preview"
			data-profile-ready={profile.id}
			role="img"
			aria-label={profile.name}
		>
			{profile.pages[0].keys
				.filter((k) => k.config.display && k.config.type !== "")
				.map((key) => (
					<div
						key={key.keyCode}
						className="profile-preview-key"
						style={{
							gridColumn: `${key.keyCode.split(",")[1]} / span ${key.config.size[0]}`,
							gridRow: `${key.keyCode.split(",")[0]} / span ${key.config.size[1]}`,
						}}
					>
						<span>{key.config.title.text || key.config.type}</span>
					</div>
				))}
		</div>
	);
}
export function ProfileThumbnail(): React.JSX.Element {
	const [profile, setProfile] = useState<Profile>();
	useEffect(() => {
		const query = new URLSearchParams(location.search);
		const locale = Schema.decodeUnknownSync(ProfileLocale)(
			query.get("locale") ?? "en",
		);
		void window.quakeProfiles
			.request({ type: "read", locale, preview: true })
			.then((reply) => {
				if (reply._tag === "success")
					setProfile(
						decode(reply.view).profiles.find(
							(p) => p.id === query.get("profile"),
						),
					);
			});
	}, []);
	return profile ? <ProfilePreview profile={profile} /> : <p>No preview</p>;
}
export function SelectedProfile(): React.JSX.Element | null {
	const [selection, setSelection] = useState<ProfileDelivery>();
	useEffect(() => {
		if (!window.quakeProfiles) return;
		const serial =
			new URLSearchParams(location.search).get("serial") ?? "desktop-preview";
		let live = false;
		const off = window.quakeProfiles.onSelection((next) => {
			if (next.serial === serial) {
				live = true;
				setSelection(next);
			}
		});
		void window.quakeProfiles
			.request({ type: "read", locale: "en", preview: true })
			.then((reply) => {
				if (live || reply._tag !== "success") return;
				const selected = reply.view.envelope.activeByDevice[serial];
				const profile = reply.view.envelope.profiles.find(
					(p) => p.id === selected?.profileId,
				);
				if (profile) setSelection({ serial, profile, hardware: "unverified" });
			});
		return () => {
			live = true;
			off();
		};
	}, []);
	return selection ? (
		<section className="selected-profile" aria-label="Selected profile">
			<ProfilePreview
				profile={Schema.decodeUnknownSync(Profile)(selection.profile)}
			/>
		</section>
	) : null;
}
function ProfileNameInput({
	name,
	commit,
}: {
	name: string;
	commit: (value: string) => Promise<boolean>;
}): React.JSX.Element {
	const [value, setValue] = useState(name);
	return (
		<span className="profile-name-input">
			<input
				aria-label={`Rename ${name}`}
				value={value}
				maxLength={20}
				onInput={(event) =>
					setValue(truncateProfileName(event.currentTarget.value))
				}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
				}}
				onBlur={async (event) => {
					const next = event.currentTarget.value;
					if (next !== name && !(await commit(next))) setValue(name);
				}}
			/>
			<small aria-live="polite">{weightedNameLength(value)}/10</small>
		</span>
	);
}
export function ProfilesManager(): React.JSX.Element {
	const [view, setView] = useState<ProfileView>();
	const [locale, setLocale] = useState<ProfileLocale>("en");
	const text = (key: string): string => profileText(key, locale);
	const [status, setStatus] = useState("");
	const [deviceChoice, setDeviceChoice] = useState({ id: "", serial: "" });
	useEffect(() => {
		if (!window.quakeProfiles) return;
		const off = window.quakeProfiles.onSnapshot(setView);
		const progress = window.quakeProfiles.onProgress((p) =>
			setView((v) => (v ? { ...v, progress: p } : v)),
		);
		void window.quakeProfiles.request({ type: "read", locale }).then((r) => {
			if (r._tag === "success") setView(r.view);
			else setStatus(r.reason);
		});
		return () => {
			off();
			progress();
		};
	}, [locale]);
	const request = async (command: ProfileRequest): Promise<boolean> => {
		const reply = await window.quakeProfiles.request(command);
		if (reply._tag === "success") {
			setView(reply.view);
			setStatus("");
			return true;
		} else
			setStatus(
				reply.reason === "duplicate"
					? text("functionWheelEditor.duplicateNameWarning")
					: reply.reason === "limit"
						? text("functionWheelEditor.profileLimitReached").replace(
								"{max}",
								"30",
							)
						: reply.reason === "QUAKE.PROFILE.THUMBNAIL_UNSUPPORTED"
							? text("functionWheelEditor.thumbnailUnsupported")
							: reply.reason === "QUAKE.PROFILE.THUMBNAIL_FAILED"
								? text("functionWheelEditor.thumbnailUpdateFailed")
								: reply.reason,
			);
		return false;
	};
	if (!view)
		return (
			<section className="profiles-manager">
				<h2>{text("functionWheelEditor.title")}</h2>
				<p role="status">{status || "Loading profiles…"}</p>
			</section>
		);
	const envelope = decode(view),
		state = managerState(envelope);
	const selected =
		envelope.profiles.find(
			(p) => p.id === envelope.activeByDevice["desktop-preview"]?.profileId,
		) ?? envelope.profiles.find((p) => !state.hidden.includes(p.id));
	const visibleCount = envelope.profiles.filter(
		(p) => !state.hidden.includes(p.id),
	).length;
	const defaults = BUILTIN_PROFILES.flatMap((b) =>
		envelope.profiles.filter((p) => p.id === b.id),
	).filter((p) => !(navigator.platform.includes("Mac") && p.id === "1-0"));
	const customs = envelope.profiles.filter((p) => !isBuiltinProfile(p.id));
	const row = (p: Profile): React.JSX.Element => (
		<li
			key={`${p.id}:${p.name}`}
			className="profile-row"
			data-selected={selected?.id === p.id}
		>
			{view.thumbnails[p.id] ? (
				<img src={view.thumbnails[p.id]} alt={p.name} />
			) : (
				<span className="profile-no-preview">
					{text("functionWheelEditor.thumbnailNoImage")}
				</span>
			)}
			<button
				type="button"
				className="profile-select"
				onClick={() =>
					void request({
						type: "manage",
						command: { type: "select", id: p.id },
					})
				}
				disabled={state.hidden.includes(p.id)}
			>
				{p.name}
			</button>
			{isBuiltinProfile(p.id) ? (
				<input
					aria-label={`Show ${p.name}`}
					type="checkbox"
					checked={!state.hidden.includes(p.id)}
					disabled={
						!state.hidden.includes(p.id) &&
						defaults.filter((p) => !state.hidden.includes(p.id)).length === 1
					}
					onChange={(e) =>
						void request({
							type: "manage",
							command: {
								type: "visibility",
								id: p.id,
								visible: e.target.checked,
							},
						})
					}
				/>
			) : (
				<>
					<ProfileNameInput
						name={p.name}
						commit={(name) =>
							request({
								type: "manage",
								command: { type: "rename", id: p.id, name },
							})
						}
					/>
					<button
						type="button"
						aria-label={`Delete ${p.name}`}
						onClick={() => {
							if (
								window.confirm(
									`${text("functionWheelEditor.deleteTitle")}\n${text("functionWheelEditor.deleteConfirm")}`,
								)
							)
								void request({
									type: "manage",
									command: { type: "delete", id: p.id, confirmed: true },
								});
						}}
					>
						×
					</button>
				</>
			)}
			<button
				type="button"
				onClick={() => void request({ type: "thumbnail", id: p.id, locale })}
			>
				{text("functionWheelEditor.thumbnailUpdate")}
			</button>
		</li>
	);
	const link = selected
		? state.links.find((l) => l.profileId === selected.id)
		: undefined;
	const device =
		selected?.id === deviceChoice.id
			? deviceChoice.serial
			: Option.getOrElse(link?.device ?? Option.none(), () => "");
	return (
		<section className="profiles-manager" aria-label="Knob Profile">
			<header>
				<h2>{text("functionWheelEditor.title")}</h2>
				<label>
					Language{" "}
					<select
						value={locale}
						onChange={(e) =>
							setLocale(Schema.decodeUnknownSync(ProfileLocale)(e.target.value))
						}
					>
						{["en", "zh", "de", "fr", "it", "es", "ja", "ko"].map((l) => (
							<option key={l}>{l}</option>
						))}
					</select>
				</label>
			</header>
			<p>
				{text("functionWheelEditor.profileLimitHint").replace("{max}", "30")} ·{" "}
				{visibleCount}/30
			</p>
			<div className="profile-batch">
				<button
					type="button"
					disabled={view.progress.running}
					onClick={() => void request({ type: "thumbnails" })}
				>
					{text("functionWheelEditor.thumbnailUpdateAll")}
				</button>
				{view.progress.running && (
					<>
						<progress value={view.progress.done} max={view.progress.total} />
						<span>
							{text("functionWheelEditor.thumbnailUpdating")
								.replace("{done}", String(view.progress.done))
								.replace("{total}", String(view.progress.total))}
						</span>
						<button
							type="button"
							onClick={() => void request({ type: "cancel-thumbnails" })}
						>
							{text("functionWheelEditor.thumbnailCancel")}
						</button>
					</>
				)}
				{view.progress.failed > 0 && (
					<span>
						{text("functionWheelEditor.thumbnailBatchFailed").replace(
							"{count}",
							String(view.progress.failed),
						)}
					</span>
				)}
			</div>
			<div className="profile-columns">
				<div>
					<h3>{text("functionWheelEditor.defaultCategory")}</h3>
					<ul>{defaults.map(row)}</ul>
				</div>
				<div>
					<h3>{text("functionWheelEditor.customizedCategory")}</h3>
					<ul>{customs.map(row)}</ul>
					{visibleCount < 30 && (
						<button
							type="button"
							onClick={() =>
								void request({ type: "manage", command: { type: "create" } })
							}
						>
							{text("functionWheelEditor.addItem")}
						</button>
					)}
				</div>
			</div>
			{selected && (
				<fieldset className="profile-settings">
					<legend>
						{text("functionWheelEditor.profileSettings")} - {selected.name}
					</legend>
					<ProfilePreview profile={selected} />
					<label>
						<input
							type="checkbox"
							checked={
								Option.isSome(state.startup) &&
								state.startup.value === selected.id
							}
							onChange={(e) => {
								const enabled = e.target.checked;
								const override =
									enabled &&
									Option.isSome(state.startup) &&
									state.startup.value !== selected.id;
								const confirmed =
									!override ||
									window.confirm(text("defaultProfileOverrideConfirmMessage"));
								if (confirmed)
									void request({
										type: "manage",
										command: {
											type: "startup",
											id: selected.id,
											enabled,
											confirmed,
										},
									});
							}}
						/>
						{text("setDefault")}
					</label>
					<h4>{text("functionWheelEditor.tabProfile")}</h4>
					<p>{text("settings.monitorFrontApp")}</p>
					<label>
						{text("settings.selectDevice")}{" "}
						<select
							value={device}
							onChange={(e) => {
								setDeviceChoice({ id: selected.id, serial: e.target.value });
								if (link)
									void request({
										type: "manage",
										command: {
											type: "link",
											id: selected.id,
											link: {
												profileId: link.profileId,
												appPath: link.appPath,
												appIdentifier: link.appIdentifier,
												...(e.target.value ? { device: e.target.value } : {}),
											},
										},
									});
							}}
						>
							<option value="">{text("settings.allDevice")}</option>
							{[...new Set([...view.serials, ...(device ? [device] : [])])].map(
								(serial) => (
									<option key={serial} value={serial}>
										{serial}
									</option>
								),
							)}
						</select>
					</label>
					<label>
						{text("settings.selectApplication")}{" "}
						<select
							value={link?.appPath ?? ""}
							onChange={(e) => {
								const app = view.apps.find(
									(app) => app.path === e.target.value,
								);
								if (app)
									void request({
										type: "manage",
										command: {
											type: "link",
											id: selected.id,
											link: {
												profileId: selected.id,
												appPath: app.path,
												appIdentifier: app.identifier,
												...(device ? { device } : {}),
											},
										},
									});
								else if (e.target.value === "other")
									void request({
										type: "choose-app",
										id: selected.id,
										...(device ? { device } : {}),
									});
								else if (e.target.value === "")
									void request({
										type: "manage",
										command: { type: "link", id: selected.id, link: null },
									});
							}}
						>
							<option value="">{text("settings.none")}</option>
							{link && (
								<option value={link.appPath}>{link.appIdentifier}</option>
							)}
							{view.apps
								.filter((app) => app.path !== link?.appPath)
								.map((app) => (
									<option key={app.path} value={app.path}>
										{app.name}
									</option>
								))}
							<option value="other">{text("settings.other")}</option>
						</select>
					</label>
					{selected.pages[0].keys
						.filter((k) => k.config.type === "cmd")
						.map((k) => (
							<button
								type="button"
								key={k.keyCode}
								onClick={() =>
									void request({
										type: "run-command",
										id: selected.id,
										keyCode: k.keyCode,
									})
								}
							>
								{k.config.title.text}
							</button>
						))}
				</fieldset>
			)}
			{status && <p role="status">{status}</p>}
		</section>
	);
}
