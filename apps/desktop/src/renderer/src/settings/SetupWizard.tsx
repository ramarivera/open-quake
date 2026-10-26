import { Schema } from "effect";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { WizardDisplay } from "../../../../../../packages/edge/src/settings/wizard-contracts";
import { DeviceReadyReply } from "../../../shared/hardware-contracts";
import { useAppLocale, useAppTranslations } from "../i18n";
import { PageHeader, Segmented } from "../ui/Form";
import type { SettingsUiFailure, WizardSnapshot } from "./bridge";
import { regionFromLocale, regionOptions } from "./regions";
import {
	canContinue,
	continueDraft,
	initialChoices,
	liveLocale,
	nextStep,
	previousStep,
	profileDefaults,
	resumeStep,
	type SetupChoices,
	type SetupStep,
	setupSteps,
} from "./setup-model";
import {
	type DisplayChoices,
	latestRead,
	type ProfileChoices,
	type RuntimeChoice,
	readDisplay,
	readProfiles,
} from "./setup-owners";
import type { SetupState, SetupStore } from "./stores";
import type strings from "./strings.json";
import "./settings.css";

import type {
	ConnectionDiagnostic,
	DisplayOrientation,
	LifecycleBridge,
} from "../../../shared/lifecycle-contracts";

type T = ReturnType<typeof useAppTranslations>;
/** Languages are always offered in their own name. */
const languages = [
	{ value: "en", label: "English" },
	{ value: "de", label: "Deutsch" },
] as const;

export function useSetupState(store: SetupStore): SetupState {
	return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function failureText(t: T, failure: SettingsUiFailure): string {
	switch (failure.code) {
		case "QUAKE.WIZARD.INCOMPLETE":
			return t("setup.failure.incomplete");
		case "QUAKE.SETTINGS.PERSIST_FAILED":
			return t("setup.failure.persist");
		case "QUAKE.SETTINGS.INVALID":
			return t("setup.failure.invalid");
		case "QUAKE.SETTINGS.READ_FAILED":
			return t("setup.failure.read");
		default:
			return t("setup.failure.unknown");
	}
}

/** Owner reads for the flow. Reads only; re-run on explicit request. */
function useOwnerChoices(locale: "en" | "de") {
	const [devices, setDevices] = useState<DisplayChoices | null>(null);
	const [profiles, setProfiles] = useState<ProfileChoices | null>(null);
	const [deviceRead] = useState(() => latestRead(setDevices));
	const [profileRead] = useState(() => latestRead(setProfiles));
	const checkDevices = useCallback(() => {
		setDevices(null);
		deviceRead.run(() => readDisplay(window.quakeHardware));
	}, [deviceRead]);
	const checkProfiles = useCallback(() => {
		setProfiles(null);
		profileRead.run(() => readProfiles(window.quakeProfileManager, locale));
	}, [profileRead, locale]);
	useEffect(() => {
		checkDevices();
		return deviceRead.cancel;
	}, [checkDevices, deviceRead]);
	useEffect(() => {
		checkProfiles();
		return profileRead.cancel;
	}, [checkProfiles, profileRead]);
	return { devices, profiles, checkDevices, checkProfiles };
}

export function SetupWizard({
	store,
	runtime,
	onLeave,
}: {
	store: SetupStore;
	runtime: RuntimeChoice;
	/** Leaves setup without completing it; progress stays saved. */
	onLeave: () => void;
}): React.JSX.Element {
	const t = useAppTranslations("settings");
	useEffect(() => {
		const bridge = window.quakeLifecycle;
		void bridge?.request({ action: "wizard", open: true }).catch(() => {});
		return () => {
			void bridge?.request({ action: "wizard", open: false }).catch(() => {});
		};
	}, []);
	const state = useSetupState(store);
	if (state.status === "unavailable" || state.status === "failed")
		return (
			<div className="setup" data-state={state.status}>
				<PageHeader title={t("setup.title")} />
				<div className="mc-empty setup-empty">
					<h3>
						{state.status === "unavailable"
							? t("setup.unavailableTitle")
							: t("setup.readFailedTitle")}
					</h3>
					<p>
						{state.status === "unavailable"
							? t("setup.unavailableBody")
							: t("setup.readFailedBody")}
					</p>
					<div className="button-row">
						{state.status === "failed" ? (
							<button
								type="button"
								className="mc-button"
								data-primary
								disabled={state.pending !== null}
								onClick={() => void store.load()}
							>
								{t("setup.retry")}
							</button>
						) : null}
						<button type="button" className="mc-button" onClick={onLeave}>
							{t("setup.openOverview")}
						</button>
					</div>
				</div>
			</div>
		);
	if (!state.snapshot)
		return (
			<div className="setup" data-state="loading">
				<PageHeader title={t("setup.title")} />
				<p role="status" className="setup-loading">
					{t("setup.loading")}
				</p>
			</div>
		);
	return (
		<SetupFlow
			store={store}
			state={state}
			snapshot={state.snapshot}
			runtime={runtime}
			onLeave={onLeave}
		/>
	);
}

function SetupFlow({
	store,
	state,
	snapshot,
	runtime,
	onLeave,
}: {
	store: SetupStore;
	state: SetupState;
	snapshot: WizardSnapshot;
	runtime: RuntimeChoice;
	onLeave: () => void;
}): React.JSX.Element {
	const t = useAppTranslations("settings");
	const steps = setupSteps(runtime);
	const [chosen, setStep] = useState<SetupStep | null>(null);
	const step =
		chosen && steps.includes(chosen) ? chosen : resumeStep(snapshot, steps);
	const [choices, setChoices] = useState<SetupChoices>(() =>
		initialChoices(
			snapshot,
			regionFromLocale(
				typeof navigator === "undefined" ? undefined : navigator.language,
			),
		),
	);
	const locale = liveLocale(useAppLocale(), snapshot.locale);
	const owners = useOwnerChoices(locale);
	const hardwareSerial =
		choices.display?._tag === "quake" ? choices.display.deviceId : undefined;
	const orientation = useOrientation(hardwareSerial, onLeave);
	const hardwareReady =
		choices.display?._tag !== "quake" ||
		(!!orientation?.connected && !orientation.isVertical);
	const heading = useRef<HTMLHeadingElement>(null);
	const shown = useRef(step);
	const headingId = useId();
	useEffect(() => {
		// Announce each new step; the first render keeps the page's natural focus.
		if (shown.current === step) return;
		shown.current = step;
		heading.current?.focus();
	});
	const devices = owners.devices ?? { state: "offline" };
	const profiles = owners.profiles ?? { state: "failed" };
	// Preselect once on arrival at Profiles; later unchecking is respected. Only
	// a successful read seeds, so a retry after a failure still preselects.
	const seeded = useRef(false);
	useEffect(() => {
		if (
			seeded.current ||
			step !== "profiles" ||
			owners.profiles?.state !== "ready"
		)
			return;
		seeded.current = true;
		const loaded = owners.profiles;
		setChoices((value) => ({
			...value,
			profileIds: profileDefaults(value.profileIds, loaded, value.display),
		}));
	}, [step, owners.profiles]);
	const current = choices;
	const busy = state.pending !== null;
	const completed = snapshot.completed;
	const index = steps.indexOf(step);
	const go = (next: SetupStep): void => setStep(next);
	const advance = async (): Promise<void> => {
		if (step === "review") {
			await store.complete();
			return;
		}
		if (await store.save(continueDraft(step, current, locale)))
			go(nextStep(steps, step));
	};
	const ready =
		step === "profiles" || step === "review"
			? owners.profiles !== null &&
				(step === "review" ||
					canContinue(step, current, devices, profiles, runtime))
			: step === "display"
				? hardwareReady &&
					owners.devices !== null &&
					canContinue(step, current, devices, profiles, runtime)
				: canContinue(step, current, devices, profiles, runtime);

	if (completed)
		return (
			<div className="setup" data-state="complete">
				<PageHeader title={t("setup.title")} />
				<section className="setup-done" aria-labelledby={headingId}>
					<h2 id={headingId}>{t("setup.done.heading")}</h2>
					<p>{t("setup.done.body")}</p>
					<Summary
						t={t}
						snapshot={snapshot}
						locale={locale}
						profiles={profiles}
						runtime={runtime}
					/>
					<p className="setup-note">
						<span
							className="status-dot"
							data-tone="offline"
							aria-hidden="true"
						/>
						{t("setup.done.hardware")}
					</p>
					{state.failure ? (
						<p role="alert" className="setup-error">
							{failureText(t, state.failure)}
						</p>
					) : null}
					<div className="setup-actions">
						<button
							type="button"
							className="mc-button"
							disabled={busy}
							aria-describedby={`${headingId}-replay`}
							onClick={() =>
								void store.replay().then((ok) => {
									if (ok) go("welcome");
								})
							}
						>
							{t("setup.done.replay")}
						</button>
						<button
							type="button"
							className="mc-button"
							data-primary
							onClick={onLeave}
						>
							{t("setup.done.overview")}
						</button>
					</div>
					<p id={`${headingId}-replay`} className="setup-meta">
						{t("setup.done.replayBody")}
					</p>
				</section>
			</div>
		);

	return (
		<div className="setup" data-state="flow" data-step={step}>
			<PageHeader title={t("setup.title")} description={t("setup.description")}>
				<button
					type="button"
					className="mc-button"
					data-variant="quiet"
					onClick={onLeave}
				>
					{t("setup.finishLater")}
				</button>
			</PageHeader>
			<div className="setup-layout">
				<ol className="setup-steps" aria-label={t("setup.stepsLabel")}>
					{steps.map((id, position) => {
						const status =
							position < index
								? "done"
								: position === index
									? "current"
									: "upcoming";
						return (
							<li
								key={id}
								data-state={status}
								aria-current={status === "current" ? "step" : undefined}
							>
								<span className="setup-step-marker" aria-hidden="true">
									{status === "done" ? "✓" : position + 1}
								</span>
								<span className="setup-step-label">
									{t(`setup.steps.${id}`)}
								</span>
								<span className="visually-hidden">
									{`, ${t(`setup.stepState.${status}`)}`}
								</span>
							</li>
						);
					})}
				</ol>
				<section className="setup-panel" aria-labelledby={headingId}>
					<p className="setup-progress">
						{t("setup.stepOf", { current: index + 1, total: steps.length })}
						<span className="setup-progress-name">
							{" · "}
							{t(`setup.steps.${step}`)}
						</span>
					</p>
					<progress
						className="setup-meter"
						aria-hidden="true"
						max={steps.length}
						value={index + 1}
					/>
					<h2 id={headingId} ref={heading} tabIndex={-1}>
						{t(
							step === "locale-region"
								? "setup.locale.heading"
								: `setup.${step}.heading`,
						)}
					</h2>
					<StepBody
						t={t}
						step={step}
						snapshot={snapshot}
						locale={locale}
						choices={current}
						setChoices={setChoices}
						devices={owners.devices}
						profiles={owners.profiles}
						runtime={runtime}
						busy={busy}
						onCheckDevices={owners.checkDevices}
						onCheckProfiles={owners.checkProfiles}
						onLanguage={(locale) =>
							void store.save({ step: "locale-region", locale })
						}
						onEdit={go}
					/>
					{state.failure ? (
						<p role="alert" className="setup-error">
							{failureText(t, state.failure)}
							{step === "review" ? ` ${t("setup.failure.notComplete")}` : ""}
						</p>
					) : null}
					<div className="setup-actions">
						{index > 0 ? (
							<button
								type="button"
								className="mc-button"
								disabled={busy}
								onClick={() => go(previousStep(steps, step))}
							>
								{t("setup.back")}
							</button>
						) : null}
						<button
							type="button"
							className="mc-button"
							data-primary
							disabled={busy || !ready}
							aria-busy={busy || undefined}
							onClick={() => void advance()}
						>
							{step === "review"
								? state.pending === "complete"
									? t("setup.review.finishing")
									: t("setup.review.finish")
								: state.pending === "save"
									? t("setup.saving")
									: t("setup.continue")}
						</button>
					</div>
				</section>
			</div>
		</div>
	);
}

function StepBody({
	t,
	step,
	snapshot,
	locale,
	choices,
	setChoices,
	devices,
	profiles,
	runtime,
	busy,
	onCheckDevices,
	onCheckProfiles,
	onLanguage,
	onEdit,
}: {
	t: T;
	step: SetupStep;
	snapshot: WizardSnapshot;
	locale: "en" | "de";
	choices: SetupChoices;
	setChoices: (update: (current: SetupChoices) => SetupChoices) => void;
	devices: DisplayChoices | null;
	profiles: ProfileChoices | null;
	runtime: RuntimeChoice;
	busy: boolean;
	onCheckDevices: () => void;
	onCheckProfiles: () => void;
	onLanguage: (locale: "en" | "de") => void;
	onEdit: (step: SetupStep) => void;
}): React.JSX.Element {
	const id = useId();
	switch (step) {
		case "welcome":
			return (
				<>
					<p className="setup-lead">{t("setup.welcome.body")}</p>
					<ul className="setup-outline">
						<li>{t("setup.welcome.language")}</li>
						<li>{t("setup.welcome.display")}</li>
						<li>{t("setup.welcome.profiles")}</li>
						{runtime.state !== "unsupported" ? (
							<li>{t("setup.welcome.runtime")}</li>
						) : null}
					</ul>
					<p className="setup-meta">{t("setup.welcome.note")}</p>
				</>
			);
		case "locale-region":
			return (
				<>
					<p className="setup-lead">{t("setup.locale.body")}</p>
					<div className="setup-fields">
						<div className="mc-field">
							<span id={`${id}-language`}>{t("setup.locale.language")}</span>
							<Segmented
								name={`${id}-language`}
								labelledBy={`${id}-language`}
								value={locale}
								options={languages}
								disabled={busy}
								onChange={onLanguage}
							/>
						</div>
						<div className="mc-field">
							<label htmlFor={`${id}-region`}>{t("setup.locale.region")}</label>
							<select
								id={`${id}-region`}
								value={choices.region}
								aria-describedby={`${id}-region-hint`}
								disabled={busy}
								onChange={(event) => {
									const region = event.target.value;
									setChoices((current) => ({ ...current, region }));
								}}
							>
								<option value="" disabled>
									{t("setup.locale.regionPlaceholder")}
								</option>
								{regionOptions(locale).map((region) => (
									<option key={region.code} value={region.code}>
										{region.name}
									</option>
								))}
							</select>
							<span id={`${id}-region-hint`} className="setup-meta">
								{snapshot.region
									? t("setup.locale.regionSaved")
									: t("setup.locale.regionSuggested")}
							</span>
						</div>
					</div>
				</>
			);
		case "display":
			return (
				<DisplayStep
					t={t}
					choices={choices}
					setChoices={setChoices}
					devices={devices}
					busy={busy}
					onCheckDevices={onCheckDevices}
				/>
			);
		case "profiles":
			return (
				<ProfilesStep
					t={t}
					choices={choices}
					setChoices={setChoices}
					profiles={profiles}
					busy={busy}
					onRetry={onCheckProfiles}
				/>
			);
		case "runtime":
			return (
				<>
					<p className="setup-lead">{t("setup.runtime.body")}</p>
					<div
						className="setup-choices"
						role="radiogroup"
						aria-label={t("setup.runtime.heading")}
					>
						<Choice
							type="radio"
							name={`${id}-runtime`}
							checked={choices.runtime === "skipped"}
							disabled={busy}
							title={t("setup.runtime.skip")}
							body={t("setup.runtime.skipBody")}
							onChange={() =>
								setChoices((current) => ({ ...current, runtime: "skipped" }))
							}
						/>
						<Choice
							type="radio"
							name={`${id}-runtime`}
							checked={choices.runtime === "configured"}
							disabled={busy || runtime.state !== "configured"}
							title={t("setup.runtime.use")}
							badge={
								runtime.state === "configured" ? (
									<span className="mc-badge" data-tone="neutral">
										{t("setup.runtime.untested")}
									</span>
								) : null
							}
							body={
								runtime.state === "configured"
									? t("setup.runtime.useBody", { count: runtime.count })
									: t("setup.runtime.notReady")
							}
							onChange={() =>
								setChoices((current) => ({
									...current,
									runtime: "configured",
								}))
							}
						/>
					</div>
				</>
			);
		case "review":
			return (
				<>
					<p className="setup-lead">{t("setup.review.body")}</p>
					<Summary
						t={t}
						snapshot={snapshot}
						locale={locale}
						profiles={profiles}
						runtime={runtime}
						onEdit={busy ? undefined : onEdit}
					/>
				</>
			);
	}
}

function Choice({
	type,
	name,
	checked,
	disabled,
	title,
	body,
	badge,
	onChange,
}: {
	type: "radio" | "checkbox";
	name: string;
	checked: boolean;
	disabled: boolean;
	title: ReactNode;
	body?: ReactNode;
	badge?: ReactNode;
	onChange: (checked: boolean) => void;
}): React.JSX.Element {
	const id = useId();
	return (
		<label className="setup-choice" data-disabled={disabled || undefined}>
			<input
				type={type}
				name={name}
				checked={checked}
				disabled={disabled}
				aria-describedby={body ? `${id}-body` : undefined}
				onChange={(event) => onChange(event.target.checked)}
			/>
			<span className="setup-choice-text">
				<span className="setup-choice-title">
					{title}
					{badge}
				</span>
				{body ? (
					<span id={`${id}-body`} className="setup-choice-body">
						{body}
					</span>
				) : null}
			</span>
		</label>
	);
}

export function DisplayStep({
	t,
	choices,
	setChoices,
	devices,
	busy,
	onCheckDevices,
}: {
	t: T;
	choices: SetupChoices;
	setChoices: (update: (current: SetupChoices) => SetupChoices) => void;
	devices: DisplayChoices | null;
	busy: boolean;
	onCheckDevices: () => void;
}): React.JSX.Element {
	const id = useId();
	const serial =
		choices.display?._tag === "quake"
			? choices.display.deviceId
			: devices?.state === "connected"
				? devices.serial
				: undefined;
	const orientation = useOrientation(serial);
	const choose = (display: WizardDisplay) =>
		setChoices((current) => ({ ...current, display }));
	const saved =
		choices.display?._tag === "quake" ? choices.display.deviceId : null;
	const connected = devices?.state === "connected" ? devices : null;
	const status = !devices
		? t("setup.display.checking")
		: devices.state === "offline"
			? t("setup.display.noDevice")
			: devices.state === "failed"
				? t("setup.display.deviceFailed")
				: devices.state === "unavailable"
					? t("setup.display.deviceUnavailable")
					: null;
	return (
		<>
			<p className="setup-lead">{t("setup.display.body")}</p>
			<div
				className="setup-choices"
				role="radiogroup"
				aria-label={t("setup.display.heading")}
			>
				<Choice
					type="radio"
					name={`${id}-display`}
					checked={connected !== null && saved === connected.serial}
					disabled={busy || connected === null}
					title={t("setup.display.quake")}
					badge={
						connected ? (
							<span
								className="mc-badge"
								data-tone={connected.mock ? "accent" : "success"}
							>
								{connected.mock
									? t("setup.display.simulated")
									: t("setup.display.connected")}
							</span>
						) : null
					}
					body={
						connected ? (
							<span className="mono">
								{t("setup.display.serial", { serial: connected.serial })}
							</span>
						) : (
							<span role="status">{status}</span>
						)
					}
					onChange={() => {
						if (connected)
							choose({ _tag: "quake", deviceId: connected.serial });
					}}
				/>
				<Choice
					type="radio"
					name={`${id}-display`}
					checked={choices.display?._tag === "desktop-preview"}
					disabled={busy}
					title={t("setup.display.preview")}
					badge={
						<span className="mc-badge" data-tone="neutral">
							{t("setup.display.unverified")}
						</span>
					}
					body={t("setup.display.previewBody")}
					onChange={() => choose({ _tag: "desktop-preview" })}
				/>
			</div>
			{connected ? (
				<OrientationConfirmation
					text={{
						title: t("setup.orientation.title"),
						portrait: t("setup.orientation.portrait"),
						landscape: t("setup.orientation.landscape"),
						recommended: t("setup.orientation.recommended"),
						success: t("setup.orientation.success"),
						disconnected: t("setup.orientation.disconnected"),
						connected: t("setup.orientation.connected"),
						vertical: t("setup.orientation.vertical"),
						horizontal: t("setup.orientation.horizontal"),
						unknown: t("setup.orientation.unknown"),
						open: t("setup.orientation.open"),
						darwin: t("setup.orientation.darwin"),
						win32: t("setup.orientation.win32"),
						other: t("setup.orientation.other"),
					}}
					orientation={orientation}
					platform={
						typeof window === "undefined"
							? undefined
							: window.quakeLifecycle?.platform
					}
					openSettings={() => {
						void window.quakeLifecycle?.request({ action: "display-settings" });
					}}
				/>
			) : null}
			{saved && saved !== connected?.serial ? (
				<p className="setup-meta" role="status">
					{t("setup.display.savedMissing", { serial: saved })}
				</p>
			) : null}
			{/* Also offered while connected: the read is a snapshot, and a swapped
			    QUAKE only appears after checking again. */}
			{devices && devices.state !== "unavailable" ? (
				<div className="button-row">
					<button
						type="button"
						className="mc-button"
						disabled={busy}
						onClick={onCheckDevices}
					>
						{t("setup.display.checkAgain")}
					</button>
				</div>
			) : null}
		</>
	);
}

export function ProfilesStep({
	t,
	choices,
	setChoices,
	profiles,
	busy,
	onRetry,
}: {
	t: T;
	choices: SetupChoices;
	setChoices: (update: (current: SetupChoices) => SetupChoices) => void;
	profiles: ProfileChoices | null;
	busy: boolean;
	onRetry: () => void;
}): React.JSX.Element {
	const id = useId();
	const activeKey =
		choices.display?._tag === "quake"
			? choices.display.deviceId
			: "desktop-preview";
	if (!profiles)
		return (
			<p role="status" className="setup-loading">
				{t("setup.profiles.loading")}
			</p>
		);
	if (profiles.state !== "ready")
		return profiles.state === "failed" ? (
			<>
				<p role="alert" className="setup-error">
					{t("setup.profiles.failed")}
				</p>
				<div className="button-row">
					<button
						type="button"
						className="mc-button"
						disabled={busy}
						onClick={onRetry}
					>
						{t("setup.retry")}
					</button>
				</div>
			</>
		) : (
			<p role="alert" className="setup-error">
				{t("setup.profiles.unavailable")}
			</p>
		);
	const selected = new Set(choices.profileIds);
	return (
		<>
			<p className="setup-lead">{t("setup.profiles.body")}</p>
			<p id={`${id}-note`} className="setup-meta">
				{t("setup.profiles.note")}
			</p>
			{profiles.profiles.length === 0 ? (
				<p className="setup-meta">{t("setup.profiles.empty")}</p>
			) : (
				<fieldset
					className="setup-choices"
					aria-describedby={`${id}-note ${id}-count`}
				>
					<legend className="visually-hidden">
						{t("setup.profiles.heading")}
					</legend>
					{profiles.profiles.map((profile) => (
						<Choice
							key={profile.id}
							type="checkbox"
							name={`${id}-profiles`}
							checked={selected.has(profile.id)}
							disabled={busy}
							title={profile.name}
							badge={
								profiles.active[activeKey] === profile.id ? (
									<span className="mc-badge" data-tone="neutral">
										{t("setup.profiles.active")}
									</span>
								) : null
							}
							onChange={(checked) =>
								setChoices((current) => ({
									...current,
									profileIds: checked
										? [
												...choices.profileIds.filter(
													(pid) => pid !== profile.id,
												),
												profile.id,
											]
										: choices.profileIds.filter((pid) => pid !== profile.id),
								}))
							}
						/>
					))}
				</fieldset>
			)}
			<p id={`${id}-count`} className="setup-meta" aria-live="polite">
				{t("setup.profiles.selected", { count: choices.profileIds.length })}
			</p>
		</>
	);
}

function Summary({
	t,
	snapshot,
	locale,
	profiles,
	runtime,
	onEdit,
}: {
	t: T;
	snapshot: WizardSnapshot;
	locale: "en" | "de";
	profiles: ProfileChoices | null;
	runtime: RuntimeChoice;
	onEdit?: ((step: SetupStep) => void) | undefined;
}): React.JSX.Element {
	const names =
		profiles?.state === "ready"
			? snapshot.profileIds.map(
					(id) =>
						profiles.profiles.find((profile) => profile.id === id)?.name ?? id,
				)
			: snapshot.profileIds;
	const region = snapshot.region
		? (regionOptions(locale).find((option) => option.code === snapshot.region)
				?.name ?? snapshot.region)
		: null;
	const rows: ReadonlyArray<{
		key: string;
		label: string;
		value: ReactNode;
		step: SetupStep;
	}> = [
		{
			key: "language",
			label: t("setup.review.language"),
			value: languages.find((language) => language.value === locale)?.label,
			step: "locale-region",
		},
		{
			key: "region",
			label: t("setup.review.region"),
			value: region ?? t("setup.review.notSet"),
			step: "locale-region",
		},
		{
			key: "display",
			label: t("setup.review.display"),
			value: !snapshot.display ? (
				t("setup.review.notSet")
			) : snapshot.display._tag === "desktop-preview" ? (
				<>
					{t("setup.display.preview")}{" "}
					<span className="mc-badge" data-tone="neutral">
						{t("setup.display.unverified")}
					</span>
				</>
			) : (
				<>
					{t("setup.display.quake")}{" "}
					<span className="mono">{snapshot.display.deviceId}</span>
				</>
			),
			step: "display",
		},
		{
			key: "profiles",
			label: t("setup.review.profiles"),
			value: names.length > 0 ? names.join(", ") : t("setup.review.notSet"),
			step: "profiles",
		},
		...(runtime.state !== "unsupported"
			? [
					{
						key: "runtime",
						label: t("setup.review.runtime"),
						value:
							snapshot.runtime === "skipped"
								? t("setup.review.runtimeSkipped")
								: snapshot.runtime === "configured"
									? runtime.state === "configured"
										? t("setup.review.runtimeNamed", { count: runtime.count })
										: t("setup.review.runtimeConfigured")
									: t("setup.review.notSet"),
						step: "runtime" as const,
					},
				]
			: []),
	];
	return (
		<dl className="setup-summary">
			{rows.map((row) => (
				<div key={row.key} className="setup-summary-row">
					<dt>{row.label}</dt>
					<dd>{row.value}</dd>
					{onEdit ? (
						<dd className="setup-summary-action">
							<button
								type="button"
								className="mc-button"
								data-variant="quiet"
								aria-label={t("setup.review.changeLabel", { item: row.label })}
								onClick={() => onEdit(row.step)}
							>
								{t("setup.review.change")}
							</button>
						</dd>
					) : null}
				</div>
			))}
		</dl>
	);
}

/**
 * Sidebar entry while setup is unfinished. Hidden when complete, unknown or
 * already open: the step rail is then the only progress indicator.
 */
export function SetupResumeEntry({
	store,
	runtime,
	current,
	onOpen,
}: {
	store: SetupStore;
	runtime: RuntimeChoice;
	current: boolean;
	onOpen: () => void;
}): React.JSX.Element | null {
	const t = useAppTranslations("settings");
	const { snapshot } = useSetupState(store);
	if (!snapshot || snapshot.completed || current) return null;
	const steps = setupSteps(runtime);
	return (
		<button type="button" className="setup-resume" onClick={onOpen}>
			<span className="status-dot" data-tone="simulated" aria-hidden="true" />
			<span className="setup-resume-text">
				<span className="setup-resume-label">{t("setup.resume.label")}</span>
				<span className="setup-resume-meta">
					{t("setup.resume.meta", {
						current: steps.indexOf(resumeStep(snapshot, steps)) + 1,
						total: steps.length,
					})}
				</span>
			</span>
		</button>
	);
}

export function observeOrientation(
	bridge: LifecycleBridge,
	serial: string,
	publish: (value: DisplayOrientation | undefined) => void,
	disconnected?: () => void,
): () => void {
	let live = true;
	let version = 0;
	let wasConnected = false;
	const accept = (status: ConnectionDiagnostic) => {
		const orientation = status.orientations?.find(
			(o) => o.serialNumber === serial && o.connected,
		);
		publish(orientation);
		if (orientation) wasConnected = true;
		else if (wasConnected && status.usb === "fail") {
			wasConnected = false;
			disconnected?.();
		}
	};
	const off = bridge.onStatus((status) => {
		version++;
		if (live) accept(status);
	});
	const poll = async () => {
		const requested = ++version;
		try {
			const result = await bridge.request({ action: "read" });
			if (live && requested === version) {
				if (result.ok) accept(result.status);
				else publish(undefined);
			}
		} catch {
			if (live && requested === version) publish(undefined);
		}
	};
	void poll();
	const timer = setInterval(() => {
		void poll();
	}, 2000);
	return () => {
		live = false;
		version++;
		clearInterval(timer);
		off();
	};
}
export function useOrientation(
	serial: string | undefined,
	disconnected?: () => void,
): DisplayOrientation | undefined {
	const [value, setValue] = useState<DisplayOrientation>();
	const onDisconnect = useRef(disconnected);
	onDisconnect.current = disconnected;
	useEffect(() => {
		setValue(undefined);
		const bridge = window.quakeLifecycle;
		if (!serial || !bridge) return;
		let live = true;
		let revision = 0;
		const off = observeOrientation(
			bridge,
			serial,
			(next) => {
				revision++;
				setValue(next);
			},
			() => {
				revision++;
				onDisconnect.current?.();
			},
		);
		const requestedRevision = revision;
		void window.quakeDeviceReady?.read(serial).then(
			(reply) => {
				const decoded = Schema.decodeUnknownOption(DeviceReadyReply)(reply);
				if (
					!live ||
					revision !== requestedRevision ||
					decoded._tag !== "Some" ||
					decoded.value._tag !== "ready" ||
					decoded.value.snapshot.serialNumber !== serial
				)
					return;
				const snapshot = decoded.value.snapshot;
				if (snapshot.rotation === undefined) return;
				setValue({
					serialNumber: serial,
					rotation: snapshot.rotation,
					connected: snapshot.connected,
					isVertical: snapshot.rotation === 90 || snapshot.rotation === 270,
					orientation:
						snapshot.rotation === 90 || snapshot.rotation === 270
							? "vertical"
							: "horizontal",
				});
			},
			() => {},
		);
		return () => {
			live = false;
			off();
		};
	}, [serial]);
	return value?.serialNumber === serial ? value : undefined;
}
export function OrientationConfirmation({
	text,
	orientation,
	platform,
	openSettings,
}: {
	text: Readonly<Record<keyof typeof strings.en.setup.orientation, string>>;
	orientation: DisplayOrientation | undefined;
	platform: string | undefined;
	openSettings: () => void;
}): React.JSX.Element {
	const ready = orientation?.connected && !orientation.isVertical;
	return (
		<section className="setup-orientation" aria-label={text.title}>
			<h3>{text.title}</h3>
			<div className="setup-choices">
				{[true, false].map((vertical) => (
					<div
						key={String(vertical)}
						className="setup-choice"
						data-ready={(!vertical && ready) || undefined}
						style={
							!vertical && ready
								? {
										borderColor: "var(--success)",
										borderWidth: 1,
										borderStyle: "solid",
									}
								: undefined
						}
					>
						<div>
							<span>{vertical ? text.portrait : text.landscape}</span>
							{!vertical && ready ? (
								<span className="mc-badge" data-tone="success">
									{text.recommended}
								</span>
							) : null}
							<svg
								viewBox="0 0 320 160"
								width="100%"
								height="120"
								aria-hidden="true"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
							>
								<rect x="30" y="18" width="160" height="100" rx="6" />
								<rect
									x="40"
									y="28"
									width="140"
									height="80"
									rx="2"
									opacity="0.6"
								/>
								<path d="M110 118v18m-30 0h60" />
								<rect
									x="196"
									y="18"
									width={vertical ? 36 : 100}
									height={vertical ? 100 : 36}
									rx="6"
								/>
							</svg>
						</div>
					</div>
				))}
			</div>
			<p role="status">
				{!orientation
					? text.unknown
					: ready
						? text.success
						: platform === "darwin"
							? text.darwin
							: platform === "win32"
								? text.win32
								: text.other}
			</p>
			<p>
				<span
					className="mc-badge"
					data-tone={orientation?.connected ? "success" : "neutral"}
				>
					{orientation?.connected ? text.connected : text.disconnected}
				</span>
				{orientation
					? ` · ${orientation.isVertical ? text.vertical : text.horizontal}`
					: null}
			</p>
			{!ready && (platform === "darwin" || platform === "win32") ? (
				<button type="button" className="mc-button" onClick={openSettings}>
					{text.open}
				</button>
			) : null}
		</section>
	);
}
