// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { managementExternalLinks } from "../../shared/management-external";
import { installManagementExternalLinks } from "./external-preload";

it("only real top-frame management link clicks request an external destination", () => {
	const send = vi.fn();
	const remove = installManagementExternalLinks(document, true, send);
	const link = document.createElement("a");
	link.href = managementExternalLinks[0];
	const label = document.createElement("span");
	link.append(label);
	document.body.append(link);
	const click = (trusted: boolean) => {
		const event = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			button: 0,
		});
		Object.defineProperty(event, "isTrusted", { value: trusted });
		label.dispatchEvent(event);
		return event;
	};
	click(false);
	expect(send).not.toHaveBeenCalled();
	expect(click(true).defaultPrevented).toBe(true);
	expect(send).toHaveBeenCalledExactlyOnceWith(managementExternalLinks[0]);
	send.mockClear();
	link.href = "https://evil.test/";
	click(true);
	expect(send).not.toHaveBeenCalled();
	remove();
	installManagementExternalLinks(document, false, send);
	link.href = managementExternalLinks[0];
	click(true);
	expect(send).not.toHaveBeenCalled();
	link.remove();
});
