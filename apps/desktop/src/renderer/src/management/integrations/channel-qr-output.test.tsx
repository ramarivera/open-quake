// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { CHANNEL_CATALOG } from "../../../../../../../packages/edge/src/channels/channel-catalog";
import recording from "../../../../main/agents/__fixtures__/whatsapp-terminal-qr.json";
import { terminalQrDecoder } from "../../../../main/agents/terminal-qr";
import type { IntegrationsBridge } from "../../../../shared/integrations";
import { button, click, element, mount } from "../dom-test";
import { ChannelSetupDrawer } from "./ChannelSetupDrawer";
import { channelStrings } from "./strings";

it("CENTER-078 displays the recorded compact login QR as a crisp image without confirming login", async () => {
	const decode = terminalQrDecoder();
	const image = recording.output.split("\n").map(decode).find(Boolean);
	expect(image).toMatch(/^data:image\/png;base64,/);
	const descriptor = CHANNEL_CATALOG.find((d) => d.id === "whatsapp");
	if (!descriptor || !image) throw new Error("Missing recorded QR");
	const request = vi.fn<IntegrationsBridge["request"]>(async () => ({
		type: "qr",
		session: {
			id: "fake-qr",
			channelId: "whatsapp",
			state: "ready",
			expiresAt: Date.now() + 60000,
			image,
			url: "",
			lines: [],
		},
	}));
	vi.stubGlobal("quakeIntegrations", { request });
	const mounted = await mount(
		<ChannelSetupDrawer
			descriptor={descriptor}
			configured={undefined}
			onClose={() => {}}
		/>,
	);
	await click(button(channelStrings.drawer.next));
	const qr = element<HTMLImageElement>(
		'dialog img[alt="WhatsApp login QR code"]',
	);
	expect(qr.src).toBe(image);
	expect(qr.width).toBe(220);
	expect(qr.height).toBe(220);
	expect(qr.style.imageRendering).toBe("pixelated");
	expect(button(channelStrings.drawer.next).disabled).toBe(true);
	await mounted.unmount();
	expect(request).toHaveBeenCalledWith({
		type: "channels.qr.cancel",
		session: "fake-qr",
	});
});
