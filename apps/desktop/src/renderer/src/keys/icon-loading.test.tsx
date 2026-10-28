// @vitest-environment happy-dom
import { act, createElement } from "react";
import { expect, it, vi } from "vitest";
import type { KeyReply, KeyRequest } from "../../../shared/key-library";
import { click, element, mount } from "../management/dom-test";
import { IconLibrary } from "./IconLibrary";

vi.mock("virtual:mdi-icons", () => ({ default: [] }));

it("offers the regular Phosphor catalog alongside existing sets and custom artwork", async () => {
	window.quakeKeyLibrary = {
		request: async (command) => ({
			_tag: "success",
			packs:
				command.type === "icons"
					? [
							{
								id: "local",
								name: "My icons",
								icons: [
									{
										id: "custom",
										name: "My artwork",
										tags: [],
										data: "data:image/png;base64,AAAA",
									},
								],
							},
						]
					: [],
		}),
		onRuntime: () => () => {},
		onPreview: () => () => {},
	};
	const view = await mount(
		createElement(IconLibrary, { onSelect: () => {}, onClose: () => {} }),
	);
	try {
		await act(async () => {
			await vi.dynamicImportSettled();
		});
		await click(element<HTMLButtonElement>('button[aria-label="Phosphor"]'));
		expect(
			element<HTMLButtonElement>('button[aria-label="Phosphor"]').getAttribute(
				"aria-pressed",
			),
		).toBe("true");
		expect(
			Number(
				element<HTMLButtonElement>(
					'button[aria-label="Phosphor"]',
				).querySelector("small")?.textContent,
			),
		).toBeGreaterThan(1000);
		expect(
			document.querySelectorAll(".icon-library-cell").length,
		).toBeGreaterThan(0);
		expect(
			document.querySelector('[aria-label="Uninstall Phosphor"]'),
		).toBeNull();
		expect(
			element<HTMLButtonElement>('button[aria-label="Material Design Icons"]'),
		).toBeDefined();
		await click(element<HTMLButtonElement>('button[aria-label="My icons"]'));
		expect(
			document.querySelector('[aria-label="Select My artwork"]'),
		).not.toBeNull();
	} finally {
		await view.unmount();
	}
});

it("MGMT-423 shows distinct operation stages, keeps search usable and dismisses on completion", async () => {
	let library = (_value: KeyReply) => {},
		applications = (_value: KeyReply) => {};
	window.quakeKeyLibrary = {
		request: (input: KeyRequest) =>
			new Promise<KeyReply>((resolve) => {
				if (input.type === "icons") library = resolve;
				else if (input.type === "application-icons") applications = resolve;
				else
					resolve({ _tag: "rejected", reason: "Unsupported fixture request" });
			}),
		onRuntime: () => () => {},
		onPreview: () => () => {},
	};
	const view = await mount(
		createElement(IconLibrary, { onSelect: () => {}, onClose: () => {} }),
	);
	try {
		expect(element(".icon-library-loading").textContent).toContain(
			"Loading icon library",
		);
		expect(element<HTMLInputElement>('input[type="search"]').disabled).toBe(
			false,
		);
		await act(async () => library({ _tag: "success", packs: [] }));
		expect(element(".icon-library-loading").textContent).toContain(
			"Loading local app icons",
		);
		expect(element<HTMLProgressElement>("progress").value).toBe(28);
		await act(async () => applications({ _tag: "success", packs: [] }));
		await act(async () => {
			await vi.dynamicImportSettled();
		});
		expect(document.querySelector(".icon-library-loading")).toBeNull();
	} finally {
		await view.unmount();
	}
});

it("MGMT-423 dismisses progress on a library failure and keeps retry available", async () => {
	window.quakeKeyLibrary = {
		request: async () => ({ _tag: "rejected", reason: "Library unavailable" }),
		onRuntime: () => () => {},
		onPreview: () => () => {},
	};
	const view = await mount(
		createElement(IconLibrary, { onSelect: () => {}, onClose: () => {} }),
	);
	try {
		expect(document.querySelector(".icon-library-loading")).toBeNull();
		expect(document.body.textContent).toContain("Library unavailable");
		expect(
			[...document.querySelectorAll("button")].some((button) =>
				button.textContent?.includes("Retry"),
			),
		).toBe(true);
	} finally {
		await view.unmount();
	}
});
