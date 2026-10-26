import { Option, Schema } from "effect";
import { useEffect, useRef, useState } from "react";
import {
	BUILTIN_PROFILES,
	isBuiltinProfile,
	profileText,
} from "../../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	type Profile,
	ProfileEnvelope,
} from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import {
	managerState,
	truncateProfileName,
	weightedNameLength,
} from "../../../../../../packages/device/src/profiles/profile-manager-invariants.js";
import type {
	ProfileRequest,
	ProfileView,
} from "../../../shared/profile-manager";
import { StripScreen, StripViewport } from "../strip/StripScreen";
import { selectedManagerProfile, subscribeManagerView } from "./manager-view";
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
			<StripViewport>
				<StripScreen
					titles="provided"
					profiles={{
						_tag: "ready",
						envelope: {
							schemaVersion: 1,
							profiles: [profile],
							activeByDevice: {},
							manager: Option.none(),
						},
					}}
					showEmptyGridDashedBorder={false}
				/>
			</StripViewport>
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
		void window.quakeProfileManager
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
	const [refreshing, setRefreshing] = useState<readonly string[]>([]);
	const [failedThumbnails, setFailedThumbnails] = useState<readonly string[]>(
		[],
	);
	const retained = useRef(
		new Map<string, { source: string; signature: string }>(),
	);
	const [deviceChoice, setDeviceChoice] = useState({ id: "", serial: "" });
	useEffect(() => {
		if (view?.progress.running) setFailedThumbnails([]);
	}, [view?.progress.running]);
	useEffect(() => {
		if (!window.quakeProfileManager) return;
		return subscribeManagerView(
			window.quakeProfileManager,
			locale,
			setView,
			(p) => setView((v) => (v ? { ...v, progress: p } : v)),
			setStatus,
		);
	}, [locale]);
	const request = async (command: ProfileRequest): Promise<boolean> => {
		const reply = await window.quakeProfileManager.request(command);
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
	const selected = selectedManagerProfile(envelope);
	const visibleCount = envelope.profiles.filter(
		(p) => !state.hidden.includes(p.id),
	).length;
	const defaults = BUILTIN_PROFILES.flatMap((b) =>
		envelope.profiles.filter((p) => p.id === b.id),
	).filter((p) => !(navigator.platform.includes("Mac") && p.id === "1-0"));
	const customs = envelope.profiles.filter((p) => !isBuiltinProfile(p.id));
	const refresh = async (id: string): Promise<void> => {
		if (view.progress.running || refreshing.includes(id)) return;
		setRefreshing((ids) => [...ids, id]);
		setFailedThumbnails((ids) => ids.filter((value) => value !== id));
		try {
			const ok = await request({ type: "thumbnail", id, locale });
			if (ok) retained.current.delete(id);
			if (!ok) setFailedThumbnails((ids) => [...ids, id]);
		} catch {
			setFailedThumbnails((ids) => [...ids, id]);
		} finally {
			setRefreshing((ids) => ids.filter((value) => value !== id));
		}
	};
	const row = (p: Profile): React.JSX.Element => (
		<li
			key={`${p.id}:${p.name}`}
			className="profile-row"
			data-selected={selected?.id === p.id}
		>
			<ProfileThumbnailCell
				profile={p}
				locale={locale}
				source={view.thumbnails[p.id] ?? ""}
				retained={retained.current}
				updating={refreshing.includes(p.id) || view.progress.running}
				failed={failedThumbnails.includes(p.id)}
				disabled={view.progress.running || refreshing.includes(p.id)}
				text={text}
				refresh={() => void refresh(p.id)}
			/>
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
				aria-label={`Duplicate ${p.name}`}
				disabled={visibleCount >= 30}
				onClick={() =>
					void request({
						type: "manage",
						command: { type: "duplicate", id: p.id, locale },
					})
				}
			>
				{text("functionWheelEditor.copy")}
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

function ProfileThumbnailCell({
	profile,
	locale,
	source,
	retained,
	updating,
	failed,
	disabled,
	text,
	refresh,
}: {
	profile: Profile;
	locale: ProfileLocale;
	source: string;
	retained: Map<string, { source: string; signature: string }>;
	updating: boolean;
	failed: boolean;
	disabled: boolean;
	text: (key: string) => string;
	refresh: () => void;
}): React.JSX.Element {
	const signature = JSON.stringify([locale, profile.pages, profile.knob]);
	const [failedImage, setFailedImage] = useState("");
	useEffect(() => {
		if (updating) setFailedImage("");
	}, [updating]);
	if (source) retained.set(profile.id, { source, signature });
	const previous = retained.get(profile.id);
	const pixels = source || previous?.source || "";
	const state =
		failed || (pixels && failedImage === pixels)
			? "failed"
			: updating
				? pixels
					? "updating"
					: "generating"
				: !pixels
					? "empty"
					: previous?.signature !== signature
						? "stale"
						: "ready";
	return (
		<div
			className="profile-thumbnail-cell"
			data-profile-id={profile.id}
			data-state={state}
		>
			{pixels && failedImage !== pixels ? (
				<img
					src={pixels}
					alt={profile.name}
					onError={() => setFailedImage(pixels)}
				/>
			) : (
				<span
					role="img"
					className="profile-thumbnail-placeholder"
					aria-label={text("functionWheelEditor.thumbnailNoImage")}
				/>
			)}
			{state === "failed" ? (
				<span
					className="profile-thumbnail-flag"
					role="status"
					title={text("functionWheelEditor.thumbnailUpdateFailed")}
				>
					⚠
					<span className="visually-hidden">
						{text("functionWheelEditor.thumbnailUpdateFailed")}
					</span>
				</span>
			) : state === "stale" ? (
				<span className="profile-thumbnail-flag">
					{text("functionWheelEditor.thumbnailStale")}
				</span>
			) : updating ? (
				<span
					className="profile-thumbnail-spinner"
					role="status"
					aria-label={state}
				/>
			) : null}
			<button
				type="button"
				disabled={disabled}
				onClick={refresh}
				title={text("functionWheelEditor.thumbnailUpdate")}
				aria-label={`${text("functionWheelEditor.thumbnailUpdate")} ${profile.name}`}
			>
				↻
			</button>
		</div>
	);
}
