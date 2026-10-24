import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
	APPEARANCE_STORAGE_KEY,
	type Appearance,
	defaultAppearance,
	type FontScale,
	LEGACY_APPEARANCE_STORAGE_KEY,
	type MotionPreference,
	parseAppearance,
	REDUCED_MOTION_QUERY,
	selectReducedMotion,
	type ThemeSelection,
	validateAppearance,
} from "./appearance";
import { type CustomTheme, customThemeTokens } from "./customTheme";
import { themes, toThemeProperties } from "./tokens";

type AppearanceState = { appearance: Appearance; notice: string };

export function subscribeAppearance(
	onChange: (appearance: Appearance, notice: string) => void,
) {
	const receive = (next: Appearance | null, notice = "") => {
		if (next) onChange(next, notice);
	};
	const onStorage = (event: StorageEvent) => {
		if (event.key !== APPEARANCE_STORAGE_KEY && event.key !== null) return;
		const next =
			event.newValue === null
				? defaultAppearance
				: parseAppearance(event.newValue);
		receive(
			next ?? defaultAppearance,
			next ? "" : "Saved appearance was invalid. Defaults restored.",
		);
	};
	window.addEventListener("storage", onStorage);
	let channel: BroadcastChannel | null = null;
	try {
		channel = new BroadcastChannel(APPEARANCE_STORAGE_KEY);
		channel.onmessage = (event: MessageEvent<unknown>) =>
			receive(validateAppearance(event.data));
	} catch {
		// Storage events still synchronize supported renderer origins.
	}
	return {
		channel,
		unsubscribe: () => {
			window.removeEventListener("storage", onStorage);
			channel?.close();
		},
	};
}

function readStoredAppearance(): AppearanceState {
	try {
		const saved =
			window.localStorage.getItem(APPEARANCE_STORAGE_KEY) ??
			window.localStorage.getItem(LEGACY_APPEARANCE_STORAGE_KEY);
		if (saved === null) return { appearance: defaultAppearance, notice: "" };
		const appearance = parseAppearance(saved);
		return appearance
			? { appearance, notice: "" }
			: {
					appearance: defaultAppearance,
					notice: "Saved appearance was invalid. Defaults restored.",
				};
	} catch {
		return {
			appearance: defaultAppearance,
			notice:
				"Appearance storage is unavailable. Changes apply for this session.",
		};
	}
}

/**
 * Persist a preference, then broadcast it to the other renderer. An unsaved
 * preference stays session-only in this renderer and is never broadcast.
 */
export function persistAppearance(
	next: Appearance,
	storage: Pick<Storage, "setItem">,
	channel: Pick<BroadcastChannel, "postMessage"> | null,
): string {
	try {
		storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
	} catch {
		return "Appearance could not be saved. Changes apply for this session.";
	}
	try {
		channel?.postMessage(next);
	} catch {
		// A successful storage write also notifies the other renderer.
	}
	return "";
}

export function useAppearance() {
	const [{ appearance, notice }, setState] = useState(readStoredAppearance);
	const current = useRef(appearance);
	const [systemReduced, setSystemReduced] = useState(
		() => window.matchMedia(REDUCED_MOTION_QUERY).matches,
	);
	const channel = useRef<BroadcastChannel | null>(null);
	const reducedMotion = selectReducedMotion(appearance.motion, systemReduced);

	useEffect(() => {
		const query = window.matchMedia(REDUCED_MOTION_QUERY);
		const update = () => setSystemReduced(query.matches);
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);

	useLayoutEffect(() => {
		const custom = appearance.customTheme;
		const base =
			appearance.theme === "custom"
				? (custom?.base ?? "dark")
				: appearance.theme;
		const tokens =
			appearance.theme === "custom" && custom
				? customThemeTokens(custom)
				: themes[base];
		const root = document.documentElement;
		for (const [property, value] of Object.entries(toThemeProperties(tokens))) {
			root.style.setProperty(property, value);
		}
		root.style.colorScheme = base === "light" ? "light" : "dark";
		root.dataset.fontScale = appearance.fontScale;
		root.style.setProperty(
			"--mc-sidebar-width",
			`${appearance.sidebarWidth ?? 218}px`,
		);
		void window.quakeManagement?.setTheme({
			base: base === "light" ? "light" : "dark",
			background: tokens.background,
			titlebar: base === "dark" ? "#0e1015" : tokens.background,
			symbol: tokens.foreground,
		});
		root.dataset.theme = appearance.theme;
		root.dataset.motion = reducedMotion ? "reduce" : "full";
	}, [appearance, reducedMotion]);

	useEffect(() => {
		const subscription = subscribeAppearance((next, notice) => {
			current.current = next;
			setState({ appearance: next, notice });
		});
		channel.current = subscription.channel;
		return () => {
			subscription.unsubscribe();
			channel.current = null;
		};
	}, []);

	const update = (
		patch: Partial<
			Pick<
				Appearance,
				"theme" | "motion" | "customTheme" | "fontScale" | "sidebarWidth"
			>
		>,
	) => {
		// File reads are asynchronous; merge into the latest received preference.
		const next = { ...current.current, ...patch };
		current.current = next;
		const message = persistAppearance(
			next,
			window.localStorage,
			channel.current,
		);
		setState({ appearance: next, notice: message });
	};

	return {
		appearance,
		notice,
		reducedMotion,
		setFontScale: (fontScale: FontScale) => update({ fontScale }),
		setSidebarWidth: (sidebarWidth: number) =>
			update({ sidebarWidth: Math.max(120, Math.min(360, sidebarWidth)) }),
		setTheme: (theme: ThemeSelection) => {
			if (theme === "custom" && !current.current.customTheme) return;
			update({ theme });
		},
		setMotion: (motion: MotionPreference) => update({ motion }),
		importTheme: (customTheme: CustomTheme) =>
			update({ theme: "custom", customTheme }),
	};
}

export type AppearanceController = ReturnType<typeof useAppearance>;
