import { useCallback, useEffect, useRef, useState } from "react";

/** DK's `system.showEmptyGridDashedBorder` (SETTINGS-013), default on. */
export const STRIP_SETTINGS_KEY = "open-quake.strip.v1";
export interface StripSettings {
	readonly version: 1;
	readonly showEmptyGridDashedBorder: boolean;
}
export const defaultStripSettings: StripSettings = {
	version: 1,
	showEmptyGridDashedBorder: true,
};

export function validateStripSettings(value: unknown): StripSettings | null {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		!("version" in value) ||
		value.version !== 1 ||
		!("showEmptyGridDashedBorder" in value) ||
		typeof value.showEmptyGridDashedBorder !== "boolean" ||
		Object.keys(value).length !== 2
	)
		return null;
	return {
		version: 1,
		showEmptyGridDashedBorder: value.showEmptyGridDashedBorder,
	};
}

export function parseStripSettings(json: string | null): StripSettings {
	if (json === null || json.length > 1024) return defaultStripSettings;
	try {
		return validateStripSettings(JSON.parse(json)) ?? defaultStripSettings;
	} catch {
		return defaultStripSettings;
	}
}

function readStored(): StripSettings {
	try {
		return parseStripSettings(window.localStorage.getItem(STRIP_SETTINGS_KEY));
	} catch {
		return defaultStripSettings;
	}
}

/**
 * Shared by the panel and management windows. Storage events and a
 * BroadcastChannel carry changes live, as the appearance preference does.
 */
export function useStripSettings() {
	const [settings, setSettings] = useState(readStored);
	const [notice, setNotice] = useState("");
	const channel = useRef<BroadcastChannel | null>(null);
	useEffect(() => {
		const onStorage = (event: StorageEvent): void => {
			if (event.key === STRIP_SETTINGS_KEY || event.key === null)
				setSettings(parseStripSettings(event.newValue));
		};
		window.addEventListener("storage", onStorage);
		try {
			channel.current = new BroadcastChannel(STRIP_SETTINGS_KEY);
			channel.current.onmessage = (event: MessageEvent<unknown>) => {
				const next = validateStripSettings(event.data);
				if (next) setSettings(next);
			};
		} catch {
			// Storage events still synchronize the other renderer.
		}
		return () => {
			window.removeEventListener("storage", onStorage);
			channel.current?.close();
			channel.current = null;
		};
	}, []);
	const setShowEmptyGridDashedBorder = useCallback((show: boolean): void => {
		const next: StripSettings = { version: 1, showEmptyGridDashedBorder: show };
		setSettings(next);
		try {
			window.localStorage.setItem(STRIP_SETTINGS_KEY, JSON.stringify(next));
			setNotice("");
		} catch {
			setNotice("The setting could not be saved. It applies to this window.");
			return;
		}
		try {
			channel.current?.postMessage(next);
		} catch {
			// The storage write already notifies the other window.
		}
	}, []);
	return { settings, notice, setShowEmptyGridDashedBorder };
}
