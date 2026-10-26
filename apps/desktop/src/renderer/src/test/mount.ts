import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

/** Real React effects and DOM events, with each test owning its root. */
export async function mount(element: ReactNode) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const render = async (next: ReactNode): Promise<void> => {
		await act(async () => root.render(next));
	};
	await render(element);
	return {
		container,
		render,
		async unmount(): Promise<void> {
			await act(async () => root.unmount());
			container.remove();
		},
	};
}

export function required<T extends Element>(
	root: ParentNode,
	selector: string,
	elementType: { new (): T },
): T {
	const element = root.querySelector(selector);
	if (!(element instanceof elementType)) throw new Error(`Missing ${selector}`);
	return element;
}

export async function dispatch(
	element: EventTarget,
	event: Event,
): Promise<void> {
	await act(async () => {
		element.dispatchEvent(event);
	});
}

export function nativeTouch(phase: "start" | "end", isEffective = true): Event {
	return new CustomEvent(`quake-sub-touch-${phase}`, {
		detail: { phase, isEffective },
	});
}
