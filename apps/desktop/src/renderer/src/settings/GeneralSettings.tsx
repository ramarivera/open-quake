import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useAppTranslations } from "../i18n";
import { LanguageControl } from "../management/LanguageControl";
import type { ManagementPage } from "../management/navigation";
import { Group, Row } from "../ui/Form";
import {
	type SettingsUiBridge,
	type SettingsUiFailure,
	settingsBridge,
} from "./bridge";
import { subscribeGeneralRefresh } from "./general-refresh";
import { InstallationGuide } from "./InstallationGuide";
import { QuakeGuideEntry } from "./QuakeGuide";
import { useSetupState } from "./SetupWizard";
import {
	createGeneralStore,
	type GeneralField,
	type GeneralState,
	type SetupStore,
} from "./stores";
import { WizardDevelopmentControls } from "./WizardDevelopmentControls";
import "./settings.css";

type T = ReturnType<typeof useAppTranslations>;

export function generalFailureText(t: T, failure: SettingsUiFailure): string {
	switch (failure.code) {
		case "QUAKE.SETTINGS.OS_APPLY_FAILED":
			return t(`general.failure.${failure.reason ?? "unavailable"}`);
		case "QUAKE.SETTINGS.PERSIST_FAILED":
			return t("general.failure.persist");
		case "QUAKE.SETTINGS.INVALID":
			return t("general.failure.invalid");
		case "QUAKE.SETTINGS.READ_FAILED":
			return t("general.failure.read");
		default:
			return t("general.failure.unknown");
	}
}

/** Language, login and background start, plus the setup and guide entries. */
export function GeneralSettings({
	setup,
	onOpenSetup,
	onOpenPage,
	bridge = settingsBridge(),
}: {
	setup: SetupStore;
	onOpenSetup: () => void;
	/** Lets the guide open a sidebar page; the guide lists places as text without it. */
	onOpenPage?: ((page: ManagementPage) => void) | undefined;
	bridge?: SettingsUiBridge | undefined;
}): React.JSX.Element {
	const t = useAppTranslations("settings");
	const id = useId();
	const [store] = useState(() => createGeneralStore(bridge));
	const state = useSyncExternalStore(
		store.subscribe,
		store.getState,
		store.getState,
	);
	useEffect(() => subscribeGeneralRefresh(store, window, document), [store]);
	const setupState = useSetupState(setup);
	const failure = (field: GeneralField) =>
		state.failure?.field === field ? (
			<span role="alert" className="general-error">
				{generalFailureText(t, state.failure.failure)}
			</span>
		) : null;
	const disabled = state.status !== "ready" || state.pending !== null;
	return (
		<Group title={t("general.heading")}>
			<Row
				label={t("general.language")}
				labelId={`${id}-language`}
				hint={t("general.languageHint")}
			>
				<LanguageControl
					name={`${id}-language-choice`}
					labelledBy={`${id}-language`}
				/>
			</Row>
			{state.status === "unavailable" || state.status === "failed" ? (
				<Row
					label={t("general.login")}
					hint={
						state.status === "unavailable" ? (
							t("general.unavailable")
						) : (
							<span role="alert" className="general-error">
								{t("general.failure.read")}
							</span>
						)
					}
				>
					{state.status === "failed" ? (
						<button
							type="button"
							className="mc-button"
							onClick={() => void store.load()}
						>
							{t("general.retry")}
						</button>
					) : null}
				</Row>
			) : (
				<>
					<Row
						label={t("general.login")}
						htmlFor={`${id}-login`}
						hint={
							<span className="general-hint">
								<span>{t("general.loginHint")}</span>
								<LoginStatus t={t} state={state} />
								{failure("launchAtLogin")}
							</span>
						}
					>
						<input
							id={`${id}-login`}
							type="checkbox"
							checked={loginChecked(state)}
							disabled={disabled || state.login.status === "checking"}
							aria-busy={state.pending === "launchAtLogin" || undefined}
							onChange={(event) =>
								void store.set("launchAtLogin", event.target.checked)
							}
						/>
					</Row>
					<Row
						label={t("general.hidden")}
						htmlFor={`${id}-hidden`}
						hint={
							<span className="general-hint">
								<span>{t("general.hiddenHint")}</span>
								{state.pending === "startHidden" ? (
									<span role="status">{t("general.applying")}</span>
								) : null}
								{failure("startHidden")}
							</span>
						}
					>
						<input
							id={`${id}-hidden`}
							type="checkbox"
							checked={state.snapshot?.startHidden ?? false}
							disabled={disabled}
							aria-busy={state.pending === "startHidden" || undefined}
							onChange={(event) =>
								void store.set("startHidden", event.target.checked)
							}
						/>
					</Row>
					{state.status === "loading" ? (
						<Row label={<span role="status">{t("general.loading")}</span>} />
					) : null}
				</>
			)}
			<Row
				label={t("general.setup")}
				hint={
					setupState.status === "ready" && setupState.snapshot
						? setupState.snapshot.completed
							? t("general.setupComplete")
							: t("general.setupIncomplete")
						: setupState.status === "loading"
							? t("general.loading")
							: setupState.status === "failed"
								? t("setup.failure.read")
								: t("general.setupUnavailable")
				}
			>
				{setupState.snapshot ? (
					<button
						type="button"
						className="mc-button"
						disabled={setupState.pending !== null}
						onClick={() => {
							if (!setupState.snapshot?.completed) onOpenSetup();
							else
								void setup.replay().then((ok) => {
									if (ok) onOpenSetup();
								});
						}}
					>
						{setupState.snapshot.completed
							? t("general.replay")
							: t("general.resume")}
					</button>
				) : setupState.status === "failed" ? (
					<button
						type="button"
						className="mc-button"
						disabled={setupState.pending !== null}
						onClick={() => void setup.load()}
					>
						{t("general.retry")}
					</button>
				) : null}
				{setupState.failure && setupState.snapshot?.completed ? (
					<span role="alert" className="general-error">
						{generalFailureText(t, setupState.failure)}
					</span>
				) : null}
			</Row>
			<Row label={t("guide.rowLabel")} hint={t("guide.rowHint")}>
				<QuakeGuideEntry onOpenPage={onOpenPage} />
				<InstallationGuide />
			</Row>
			<WizardDevelopmentControls store={setup} onOpen={onOpenSetup} />
		</Group>
	);
}

/** The OS readback wins; saved intent is shown only when it is unknown. */
function loginChecked(state: GeneralState): boolean {
	if (state.login.status === "known") return state.login.enabled;
	return state.snapshot?.launchAtLogin ?? false;
}

function LoginStatus({
	t,
	state,
}: {
	t: T;
	state: GeneralState;
}): React.JSX.Element | null {
	if (state.pending === "launchAtLogin")
		return <span role="status">{t("general.applying")}</span>;
	if (state.login.status === "checking")
		return <span role="status">{t("general.loginChecking")}</span>;
	if (state.login.status === "unknown" && state.snapshot)
		return (
			<span role="status">
				{t("general.loginUnknown", {
					value: state.snapshot.launchAtLogin
						? t("general.on")
						: t("general.off"),
				})}
			</span>
		);
	return null;
}
