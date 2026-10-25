import {
	type GeneralSnapshot,
	type SettingsUiBridge,
	type SettingsUiFailure,
	settingsFailure,
	type WizardDraft,
	type WizardSnapshot,
} from "./bridge";

/** Tiny external stores: one request at a time, newest revision wins. */
type Store<S> = {
	readonly getState: () => S;
	readonly subscribe: (listener: () => void) => () => void;
};
function store<S>(initial: S) {
	let state = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => state,
		set: (next: S) => {
			state = next;
			for (const listener of listeners) listener();
		},
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export type SetupPending = "read" | "save" | "complete" | "replay";
export type SetupState = {
	readonly status: "loading" | "ready" | "unavailable" | "failed";
	readonly snapshot: WizardSnapshot | null;
	readonly pending: SetupPending | null;
	readonly failure: SettingsUiFailure | null;
};
export type SetupStore = Store<SetupState> & {
	readonly load: () => Promise<boolean>;
	readonly save: (draft: WizardDraft) => Promise<boolean>;
	readonly complete: () => Promise<boolean>;
	readonly replay: () => Promise<boolean>;
};

export function createSetupStore(
	bridge: SettingsUiBridge | undefined,
): SetupStore {
	const s = store<SetupState>({
		status: bridge ? "loading" : "unavailable",
		snapshot: null,
		pending: null,
		failure: null,
	});
	const run = async (
		pending: SetupPending,
		call: (bridge: SettingsUiBridge) => Promise<WizardSnapshot>,
	): Promise<boolean> => {
		if (!bridge || s.get().pending) return false;
		s.set({ ...s.get(), pending, failure: null });
		try {
			const next = await call(bridge);
			const current = s.get().snapshot;
			s.set({
				status: "ready",
				snapshot:
					!current || next.revision >= current.revision ? next : current,
				pending: null,
				failure: null,
			});
			return true;
		} catch (error) {
			const current = s.get();
			s.set({
				status: current.snapshot ? "ready" : "failed",
				snapshot: current.snapshot,
				pending: null,
				failure: settingsFailure(error),
			});
			return false;
		}
	};
	return {
		getState: s.get,
		subscribe: s.subscribe,
		load: () => run("read", (bridge) => bridge.wizard()),
		save: (draft) => run("save", (bridge) => bridge.saveWizard(draft)),
		complete: () => run("complete", (bridge) => bridge.completeWizard()),
		replay: () => run("replay", (bridge) => bridge.replayWizard()),
	};
}

/** `known` is the OS-confirmed login state; saved intent alone is not proof. */
export type LoginState =
	| { readonly status: "checking" }
	| { readonly status: "known"; readonly enabled: boolean }
	| { readonly status: "unknown"; readonly failure: SettingsUiFailure };
export type GeneralField = "launchAtLogin" | "startHidden";
export type GeneralState = {
	readonly status: "loading" | "ready" | "unavailable" | "failed";
	readonly snapshot: GeneralSnapshot | null;
	readonly login: LoginState;
	readonly pending: GeneralField | null;
	readonly failure: {
		readonly field: GeneralField | "read";
		readonly failure: SettingsUiFailure;
	} | null;
};
export type GeneralStore = Store<GeneralState> & {
	readonly load: () => Promise<void>;
	readonly set: (field: GeneralField, value: boolean) => Promise<boolean>;
};

export function createGeneralStore(
	bridge: SettingsUiBridge | undefined,
): GeneralStore {
	const s = store<GeneralState>({
		status: bridge ? "loading" : "unavailable",
		snapshot: null,
		login: bridge
			? { status: "checking" }
			: { status: "unknown", failure: { code: "unknown" } },
		pending: null,
		failure: null,
	});
	let readGeneration = 0;
	const accept = (next: GeneralSnapshot): GeneralSnapshot => {
		const current = s.get().snapshot;
		return !current || next.revision >= current.revision ? next : current;
	};
	const readLogin = async (bridge: SettingsUiBridge): Promise<LoginState> => {
		try {
			return { status: "known", enabled: await bridge.loginStatus() };
		} catch (error) {
			return { status: "unknown", failure: settingsFailure(error) };
		}
	};
	const read = async (bridge: SettingsUiBridge) => {
		const [snapshot, login] = await Promise.all([
			bridge.general().then(
				(value) => ({ ok: true as const, value }),
				(error: unknown) => ({ ok: false as const, error }),
			),
			readLogin(bridge),
		]);
		return { snapshot, login };
	};
	return {
		getState: s.get,
		subscribe: s.subscribe,
		load: async () => {
			if (!bridge || s.get().pending) return;
			const generation = ++readGeneration;
			const { snapshot, login } = await read(bridge);
			if (generation !== readGeneration) return;
			const current = s.get();
			s.set({
				...current,
				status: snapshot.ok ? "ready" : current.snapshot ? "ready" : "failed",
				snapshot: snapshot.ok ? accept(snapshot.value) : current.snapshot,
				login,
				failure: snapshot.ok
					? null
					: { field: "read", failure: settingsFailure(snapshot.error) },
			});
		},
		set: async (field, value) => {
			if (!bridge || s.get().pending) return false;
			readGeneration++;
			s.set({ ...s.get(), pending: field, failure: null });
			try {
				const saved = await bridge.saveGeneral(
					field === "launchAtLogin"
						? { launchAtLogin: value }
						: { startHidden: value },
				);
				// Only the OS readback can confirm a login change.
				const login =
					field === "launchAtLogin" ? await readLogin(bridge) : s.get().login;
				s.set({
					...s.get(),
					status: "ready",
					snapshot: accept(saved),
					login,
					pending: null,
				});
				return true;
			} catch (error) {
				const failure = settingsFailure(error);
				// Saved intent can survive an OS refusal: requery both before showing state.
				const { snapshot, login } = await read(bridge);
				s.set({
					...s.get(),
					snapshot: snapshot.ok ? accept(snapshot.value) : s.get().snapshot,
					login,
					pending: null,
					failure: { field, failure },
				});
				return false;
			}
		},
	};
}
