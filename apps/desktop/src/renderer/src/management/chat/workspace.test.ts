import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRichText } from "../../strip/tiles/clawBot/rich-text";
import { DirectChatPanel } from "./DirectChatPanel";
import { Prose } from "./Prose";

const model = {
	ready: true,
	row: {
		id: "row",
		role: "default" as const,
		provider: "generic",
		model: "synthetic-model",
		baseUrl: "http://127.0.0.1:1/v1",
		maxTokens: 512,
		credentialAvailable: true,
	},
};

describe("conversation workspace rendering", () => {
	beforeEach(() => vi.stubGlobal("window", {}));
	afterEach(() => vi.unstubAllGlobals());
	it("renders generated markup as inert text with formatting", () => {
		const html = renderToStaticMarkup(
			createElement(Prose, {
				value: parseRichText(
					'You have **three meetings**.\n\n<script>globalThis.x=1</script>\n<img src="https://invalid.example/a">\n\n```sh\necho inert\n```',
				),
				onOpen: () => {},
				linkHint: "Opens in your browser",
			}),
		);
		expect(html).toContain("<strong>");
		expect(html).toContain("<pre><code>echo inert</code></pre>");
		expect(html).not.toMatch(/<script|<img/);
		expect(html).toContain("&lt;script&gt;");
	});
	it("offers AI configuration when no effective model is ready", () => {
		const html = renderToStaticMarkup(
			createElement(DirectChatPanel, {
				bridge: undefined,
				model: { ready: false, row: undefined },
				onOpenSettings: () => {},
			}),
		);
		expect(html).toContain("No model set up");
		expect(html).toMatch(/<textarea[^>]*disabled/);
		expect(html).toContain("Model settings");
	});
	it("states where QUAKE requests go without changing the selection", () => {
		const elsewhere = renderToStaticMarkup(
			createElement(DirectChatPanel, {
				bridge: undefined,
				model,
				quake: { runtime: "Studio Hermes", busy: false, useDirect: () => {} },
			}),
		);
		expect(elsewhere).toContain("QUAKE requests go to Studio Hermes.");
		expect(elsewhere).toContain("Answer QUAKE here");
		expect(elsewhere).toContain("Answers from generic / synthetic-model");
		const here = renderToStaticMarkup(
			createElement(DirectChatPanel, { bridge: undefined, model }),
		);
		expect(here).toContain("QUAKE requests are answered here.");
		expect(here).not.toContain("Answer QUAKE here");
	});
	it("keeps the session list free of non-session buttons and labels Stop and Send", () => {
		const html = renderToStaticMarkup(
			createElement(DirectChatPanel, { bridge: undefined, model }),
		);
		const history = html.match(
			/<nav[^>]*direct-chat-history[^>]*>([\s\S]*?)<\/nav>/,
		)?.[1];
		expect(history).toBeDefined();
		expect(history).not.toContain("<button");
		expect(html).toMatch(/<button type="submit"[^>]*>Send<svg/);
	});
});
