// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { CHANNEL_CATALOG } from "../../../../../../../packages/edge/src/channels/channel-catalog";
import type { ChannelView } from "../../../../../../../packages/edge/src/channels/channel-contracts";
import { button, click, element, mount } from "../dom-test";
import { ChannelsPage } from "../integrations/ChannelsPage";

it("CENTER-075/048 shows truthful channel states, accessible Connect/Manage and portal failure and publishes successful changes", async () => {
	let state: ChannelView["state"] = "Configured";
	const request = vi.fn(async (command: { type: string }) =>
		command.type === "channels.portal"
			? {
					type: "error",
					code: "INTEGRATION.INPUT.REJECTED",
					message: "Portal failed",
					field: "URL",
				}
			: {
					type: "channels",
					channels: CHANNEL_CATALOG.map((d) => ({
						id: d.id,
						state:
							d.id === "discord"
								? state
								: d.id === "whatsapp"
									? "Unavailable"
									: "Not configured",
						configured: d.id === "discord",
						enabled: state !== "Disabled",
						publicFields: {},
						reason: d.id === "whatsapp" ? "Gateway offline" : "",
					})),
				},
	);
	vi.stubGlobal("quakeIntegrations", { request });
	const invalidated = vi.fn();
	window.addEventListener("agents:settings-invalidated", invalidated);
	try {
		await mount(<ChannelsPage />);
		expect(document.querySelectorAll(".mc-channel-grid article")).toHaveLength(
			6,
		);
		expect(element('button[aria-label="Manage Discord"]').tagName).toBe(
			"BUTTON",
		);
		expect(
			element<HTMLButtonElement>('button[aria-label="Connect WhatsApp"]')
				.disabled,
		).toBe(true);
		expect(
			element('button[aria-label="Connect Feishu"]').getAttribute("type"),
		).toBe("button");
		const discord = element('button[aria-label="Manage Discord"]').closest(
			"article",
		);
		if (!discord) throw new Error("Missing Discord card");
		await click(button("Open developer portal", discord));
		expect(element("[role=alert]").textContent).toContain("Portal failed");
		state = "Disabled";
		await click(button("Refresh"));
		expect(discord.textContent).toContain("Disabled");
		state = "Connected";
		await click(button("Refresh"));
		expect(discord.textContent).toContain("Connected");
		expect(invalidated).toHaveBeenCalledTimes(3);
		await click(element('button[aria-label="Manage Discord"]'));
		expect(document.querySelector("dialog")).not.toBeNull();
	} finally {
		window.removeEventListener("agents:settings-invalidated", invalidated);
	}
});
