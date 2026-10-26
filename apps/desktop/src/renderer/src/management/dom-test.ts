import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import { AppLocaleProvider } from "../i18n";

let roots: Root[] = [];
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
	for (const root of roots) await act(async () => root.unmount());
	roots = [];
	document.body.replaceChildren();
	vi.unstubAllGlobals();
});

export async function mount(children: ReactNode, locale = true) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	roots.push(root);
	await act(async () => {
		root.render(
			locale
				? createElement(AppLocaleProvider, { children, bridge: null })
				: children,
		);
	});
	return {
		host,
		unmount: async () => {
			await act(async () => root.unmount());
			roots = roots.filter((item) => item !== root);
		},
	};
}
export function element<T extends Element = HTMLElement>(selector: string): T {
	const node = document.querySelector<T>(selector);
	if (!node) throw new Error(`Missing element: ${selector}`);
	return node;
}
export function button(text: string, scope: ParentNode = document) {
	const node = [...scope.querySelectorAll("button")].find(
		(item) => item.textContent?.trim() === text,
	);
	if (!node) throw new Error(`Missing button: ${text}`);
	return node;
}
export async function click(node: HTMLElement) {
	await act(async () => node.click());
}
export async function input(
	node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
	value: string,
) {
	await act(async () => {
		const prototype =
			node instanceof HTMLInputElement
				? HTMLInputElement.prototype
				: node instanceof HTMLTextAreaElement
					? HTMLTextAreaElement.prototype
					: HTMLSelectElement.prototype;
		Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(node, value);
		node.dispatchEvent(
			new Event(node instanceof HTMLSelectElement ? "change" : "input", {
				bubbles: true,
			}),
		);
	});
}
