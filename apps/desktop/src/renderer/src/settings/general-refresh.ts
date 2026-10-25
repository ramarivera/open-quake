import type { GeneralStore } from "./stores";

/** Reconcile OS readback on return, without racing an explicit preference save. */
export function subscribeGeneralRefresh(
	store: GeneralStore,
	windowEvents: EventTarget,
	visibility: EventTarget & { readonly visibilityState: string },
): () => void {
	let active = true;
	let deferred = false;
	const refresh = (): void => {
		if (!active) return;
		if (store.getState().pending) {
			deferred = true;
			return;
		}
		deferred = false;
		void store.load();
	};
	const visible = (): void => {
		if (visibility.visibilityState === "visible") refresh();
	};
	const unsubscribe = store.subscribe(() => {
		if (deferred && !store.getState().pending) refresh();
	});
	windowEvents.addEventListener("focus", refresh);
	visibility.addEventListener("visibilitychange", visible);
	refresh();
	return () => {
		active = false;
		unsubscribe();
		windowEvents.removeEventListener("focus", refresh);
		visibility.removeEventListener("visibilitychange", visible);
	};
}
