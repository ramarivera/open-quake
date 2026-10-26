// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { CHANNEL_CATALOG } from "../../../../../../../packages/edge/src/channels/channel-catalog";
import type {
	IntegrationReply,
	IntegrationsBridge,
} from "../../../../shared/integrations";
import { button, click, element, input, mount } from "../dom-test";
import { ChannelSetupDrawer } from "./ChannelSetupDrawer";
import { ShortcutsPage } from "./ShortcutsPage";
import { channelStrings, shortcutStrings } from "./strings";

function install(request: IntegrationsBridge["request"]) {
	Object.defineProperty(window, "quakeIntegrations", {
		configurable: true,
		value: { request, onHaLive: () => () => {} } satisfies IntegrationsBridge,
	});
}
afterEach(() => {
	vi.useRealTimers();
	Reflect.deleteProperty(window, "quakeIntegrations");
});

it("CENTER-093 toggles presets, validates empty input, counts characters and submits the custom app", async () => {
	const request = vi.fn<IntegrationsBridge["request"]>(async () => ({
		type: "libraries",
		libraries: [],
		aiAvailable: true,
	}));
	install(request);
	await mount(createElement(ShortcutsPage));
	const chip = element<HTMLButtonElement>("fieldset button[aria-pressed]");
	const prompt = element<HTMLInputElement>("input[maxlength='180']");
	await click(chip);
	expect(chip.getAttribute("aria-pressed")).toBe("true");
	expect(prompt.value).not.toBe("");
	await click(chip);
	expect(prompt.value).toBe("");
	expect(chip.getAttribute("aria-pressed")).toBe("false");
	await click(element("button[type=submit]"));
	expect(document.activeElement).toBe(prompt);
	expect(element("[role=alert]").textContent).toBe(shortcutStrings.needPrompt);
	expect(
		request.mock.calls.filter(
			([command]) => command.type === "shortcuts.generate",
		),
	).toHaveLength(0);
	await input(
		element<HTMLSelectElement>("form select"),
		shortcutStrings.customAppName,
	);
	await input(element<HTMLInputElement>("input[maxlength='100']"), "My Editor");
	await input(prompt, "x".repeat(180));
	expect(document.body.textContent).toContain("180/180");
	await input(prompt, "Format document");
	await act(async () => element<HTMLFormElement>("form").requestSubmit());
	expect(request).toHaveBeenLastCalledWith({
		type: "shortcuts.generate",
		app: "My Editor",
		prompt: "Format document",
	});
});

it.each(["qqbot", "feishu", "wecom"])(
	"CENTER-076 drives required credentials and masked confirmation for %s",
	async (id) => {
		const descriptor = CHANNEL_CATALOG.find((channel) => channel.id === id);
		if (!descriptor) throw new Error(`Missing descriptor ${id}`);
		const request = vi.fn<IntegrationsBridge["request"]>(async () => ({
			type: "channels",
			channels: [],
			catalog: CHANNEL_CATALOG,
		}));
		install(request);
		const onClose = vi.fn();
		await mount(
			createElement(ChannelSetupDrawer, {
				descriptor,
				configured: undefined,
				onClose,
			}),
		);
		const next = () => button(channelStrings.drawer.next);
		expect(next().disabled).toBe(true);
		await click(element("dialog"));
		expect(onClose).not.toHaveBeenCalled();
		await click(element("input[type=checkbox]"));
		await click(next());
		await click(next());
		expect(element("[role=alert]").textContent).toBe(
			"Complete the required credentials",
		);
		const fields = [
			...document.querySelectorAll<HTMLInputElement>("dialog input"),
		];
		if (id === "qqbot") {
			const data = new DataTransfer();
			data.setData("text", " 12345 : synthetic-secret-6789 ");
			await act(async () =>
				fields[0]?.dispatchEvent(
					new ClipboardEvent("paste", {
						clipboardData: data,
						bubbles: true,
						cancelable: true,
					}),
				),
			);
			expect(fields.map((field) => field.value)).toEqual([
				"12345",
				"synthetic-secret-6789",
			]);
		} else {
			for (const field of fields)
				await input(
					field,
					field.type === "password" ? "synthetic-secret-6789" : "12345",
				);
		}
		if (id === "feishu")
			await input(element<HTMLSelectElement>("dialog select"), "lark");
		await click(next());
		expect(element("dialog dl").textContent).toContain("••••6789");
		expect(element("dialog dl").textContent).not.toContain("synthetic-secret");
		if (id === "feishu")
			expect(element("dialog dl").textContent).toContain("lark");
		await click(element("dialog"));
		expect(onClose).not.toHaveBeenCalled();
		await click(button(channelStrings.drawer.finish));
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({ type: "channels.save", id }),
		);
		await click(element("dialog"));
		expect(onClose).toHaveBeenCalledOnce();
	},
);

it("CENTER-076 waits for confirmed QR progress and cancels its session on unmount", async () => {
	const descriptor = CHANNEL_CATALOG.find(
		(channel) => channel.id === "whatsapp",
	);
	if (!descriptor) throw new Error("Missing WhatsApp descriptor");
	let confirmed = false;
	const request = vi.fn<IntegrationsBridge["request"]>(
		async (command): Promise<IntegrationReply> =>
			command.type.startsWith("channels.qr.")
				? {
						type: "qr",
						session: {
							id: "synthetic-qr",
							state: confirmed ? "confirmed" : "pending",
							channelId: "whatsapp",
							expiresAt: Date.now() + 60000,
							image: "",
							url: "",
							lines: [],
						},
					}
				: { type: "ok", message: "" },
	);
	install(request);
	const mounted = await mount(
		createElement(ChannelSetupDrawer, {
			descriptor,
			configured: undefined,
			onClose: vi.fn(),
		}),
	);
	await click(button(channelStrings.drawer.next));
	expect(button(channelStrings.drawer.next).disabled).toBe(true);
	confirmed = true;
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 800));
	});
	expect(button(channelStrings.drawer.next).disabled).toBe(false);
	await mounted.unmount();
	expect(request).toHaveBeenCalledWith({
		type: "channels.qr.cancel",
		session: "synthetic-qr",
	});
});

it.each(["close", "unmount"])(
	"CENTER-076 cancels pending QR login on %s and ignores its late confirmation",
	async (closure) => {
		vi.useFakeTimers();
		const descriptor = CHANNEL_CATALOG.find(
			(channel) => channel.id === "whatsapp",
		);
		if (!descriptor) throw new Error("Missing WhatsApp descriptor");
		const session = {
			id: "pending-qr",
			state: "pending",
			channelId: "whatsapp",
			expiresAt: Date.now() + 60000,
			image: "data:image/png;base64,c3ludGhldGlj",
			url: "",
			lines: [],
		} as const;
		let confirm: (reply: IntegrationReply) => void = () => {
			throw new Error("QR read hasn't started");
		};
		const request = vi.fn<IntegrationsBridge["request"]>(
			async (command): Promise<IntegrationReply> => {
				if (command.type === "channels.qr.start")
					return { type: "qr", session };
				if (command.type === "channels.qr.read")
					return new Promise((resolve) => {
						confirm = resolve;
					});
				return { type: "ok", message: "" };
			},
		);
		install(request);
		const onClose = vi.fn();
		const mounted = await mount(
			createElement(ChannelSetupDrawer, {
				descriptor,
				configured: undefined,
				onClose,
			}),
		);
		await click(button(channelStrings.drawer.next));
		expect(button(channelStrings.drawer.next).disabled).toBe(true);
		expect(element<HTMLImageElement>("dialog img").src).toBe(session.image);
		await act(async () => vi.advanceTimersByTimeAsync(750));
		expect(request).toHaveBeenLastCalledWith({
			type: "channels.qr.read",
			session: session.id,
		});
		if (closure === "close") {
			await click(
				element(`button[aria-label='${channelStrings.drawer.close}']`),
			);
			expect(onClose).toHaveBeenCalledOnce();
		} else {
			await mounted.unmount();
			expect(document.querySelector("dialog")).toBeNull();
			expect(vi.getTimerCount()).toBe(0);
		}
		expect(request).toHaveBeenLastCalledWith({
			type: "channels.qr.cancel",
			session: session.id,
		});
		await act(async () => {
			confirm({ type: "qr", session: { ...session, state: "confirmed" } });
		});
		if (closure === "close") {
			// Keep the closed drawer mounted until the reply arrives to prove it
			// ignores confirmation, independently of React discarding unmounted state.
			expect(button(channelStrings.drawer.next).disabled).toBe(true);
			expect(element("dialog").textContent).not.toContain("confirmed");
			await mounted.unmount();
		}
		await act(async () => vi.advanceTimersByTimeAsync(3000));
		expect(document.querySelector("dialog")).toBeNull();
		expect(document.querySelector("img")).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
		expect(
			request.mock.calls.filter(
				([command]) => command.type === "channels.qr.read",
			),
		).toHaveLength(1);
		expect(request).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "channels.save" }),
		);
	},
);
