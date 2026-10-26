import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";

// Real React consumers run in happy-dom. Native device/host effects stay at bridges.
export async function mount(node: ReactNode) {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => root.render(node));
	return {
		host,
		async render(next: ReactNode) {
			await act(async () => root.render(next));
		},
		async close() {
			await act(async () => root.unmount());
			host.remove();
		},
	};
}
export function query<T extends Element>(
	host: ParentNode,
	selector: string,
	type: { new (): T },
): T {
	const element = host.querySelector(selector);
	if (!(element instanceof type)) throw new Error(`Missing ${selector}`);
	return element;
}
export async function click(element: HTMLElement) {
	await act(async () => element.click());
}
export async function input(
	element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
	value: string,
) {
	const prototype =
		element instanceof HTMLSelectElement
			? HTMLSelectElement.prototype
			: element instanceof HTMLTextAreaElement
				? HTMLTextAreaElement.prototype
				: HTMLInputElement.prototype;
	Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
		element,
		value,
	);
	await act(async () => {
		element.dispatchEvent(new Event("input", { bubbles: true }));
		element.dispatchEvent(new Event("change", { bubbles: true }));
	});
}
export async function settle(assertion: () => void) {
	await vi.waitFor(async () => {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		assertion();
	});
}
export function button(host: ParentNode, label: string): HTMLButtonElement {
	const found = Array.from(host.querySelectorAll("button")).find(
		(b) =>
			b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
	);
	if (!found) throw new Error(`Missing button ${label}`);
	return found;
}
