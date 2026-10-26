// @vitest-environment happy-dom
import { act, createElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { button, click, element, mount } from "../management/dom-test";
import { InstallationGuide } from "./InstallationGuide";

beforeEach(() => {
	vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
		function (this: HTMLDialogElement) {
			this.open = true;
		},
	);
	vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
		this: HTMLDialogElement,
	) {
		this.open = false;
	});
});
it("SETTINGS-068/069 opens offline illustrated steps, changes only guide language and resets on close", async () => {
	await mount(createElement(InstallationGuide));
	await click(button("Installation Guide"));
	expect(document.body.textContent).toContain("left USB-C input port");
	expect(document.body.textContent).toContain("Mini HDMI");
	expect(document.body.textContent).toContain("latch engages");
	expect(document.body.textContent).toContain("Box Contents");
	expect(document.querySelector("svg[role=img]")).not.toBeNull();
	await act(async () =>
		element("dialog").dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
		),
	);
	expect(document.body.textContent).toContain(
		"DisplayPort output to Quake's HDMI input",
	);
	await click(button("3. Laptop Setup"));
	expect(document.body.textContent).toContain("USB-C port that supports DP");
	await click(button("中文"));
	expect(document.body.textContent).toContain("连接笔记本");
	await act(async () =>
		element("dialog").dispatchEvent(new Event("cancel", { cancelable: true })),
	);
	expect(document.querySelector("dialog")).toBeNull();
	expect(document.activeElement).toBe(button("Installation Guide"));
	await click(button("Installation Guide"));
	expect(document.body.textContent).toContain("1 / 3");
	expect(document.body.textContent).toContain("left USB-C input port");
});
