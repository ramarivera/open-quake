import { Option } from "effect";
import { act } from "react";
import { type StripLocale, stripText } from "../strip/overlays/voice/strings";
import {
	click,
	delta,
	element,
	mount,
	started,
	tap,
	tileProps,
	turnId,
} from "../strip/render-test-fixtures";
import { ClawBotTile, clawBotScale } from "../strip/tiles/clawBot/ClawBotTile";
import {
	appendHint,
	initialConversation,
	reduceConversation,
} from "../strip/tiles/clawBot/conversation";
import { locales, rendered, view } from "./smoke-fixtures";

const nativeRequire: NodeJS.Require = globalThis.require;
const assert: typeof import("node:assert/strict") =
	nativeRequire("node:assert/strict");
export async function chatSmoke() {
	let passed = 0;
	const screen = await mount(null);
	const show = async (
		conversation = initialConversation,
		locale: StripLocale = "en",
		wheelOpen = false,
	) =>
		screen.render(
			<ClawBotTile
				{...tileProps("quakeBot", {
					view: view(conversation),
					locale,
					wheelOpen,
				})}
			/>,
		);
	try {
		for (const wheel of [false, true]) {
			await show(rendered("hello"), "en", wheel);
			const card = element(".clawbot"),
				s = clawBotScale(card.clientWidth, card.clientHeight),
				header = element(".clawbot-header"),
				title = element(".clawbot-title");
			assert.equal(getComputedStyle(card).backgroundColor, "rgb(21, 23, 26)");
			assert.equal(getComputedStyle(card).backdropFilter, "none");
			assert.equal(
				getComputedStyle(card).overflow,
				wheel ? "visible" : "hidden",
			);
			assert(Math.abs(header.getBoundingClientRect().height - 64 * s) < 0.1);
			assert(
				Math.abs(parseFloat(getComputedStyle(header).paddingLeft) - 24 * s) <
					0.1,
			);
			assert(Math.abs(element(".clawbot-title-icon").clientWidth - 36 * s) < 1);
			assert(title.scrollWidth <= title.clientWidth);
			assert(
				title.getBoundingClientRect().right <=
					element(".clawbot-pill").getBoundingClientRect().left,
			);
			passed++;
		}
		for (const connection of [
			"checking",
			"noService",
			"connecting",
			"connected",
			"disconnected",
		] as const) {
			document.documentElement.dataset.motion = "full";
			await show({ ...initialConversation, connection });
			assert.equal(
				element(".clawbot-badge").textContent,
				stripText("en", `quakeBotIconView.${connection}`),
			);
			const dot = element(".clawbot-badge-dot"),
				pulsing = ["checking", "connecting", "connected"].includes(connection);
			assert.equal(
				getComputedStyle(dot).animationName,
				pulsing ? "clawbot-pulse" : "none",
			);
			if (pulsing) assert.equal(getComputedStyle(dot).animationDuration, "2s");
			document.documentElement.dataset.motion = "reduce";
			assert.equal(getComputedStyle(dot).animationName, "none");
			passed++;
		}
		document.documentElement.dataset.motion = "full";
		for (const [id, glyph] of [
			["weather", "☀️"],
			["code", "💻"],
			["chat", "💬"],
			["assistant", "🤖"],
			["system", "ℹ️"],
			["custom", "🤖"],
		]) {
			if (!id || !glyph) throw new Error("avatar fixture");
			let conversation = reduceConversation(
				initialConversation,
				{ ...started(), agent: { id, name: id, icon: "4" } },
				Date.now(),
			);
			conversation = reduceConversation(
				conversation,
				delta("answer"),
				Date.now(),
			);
			await show(conversation);
			const avatars = document.querySelectorAll<HTMLElement>(".clawbot-avatar");
			assert.equal(avatars[0]?.textContent, "✏️");
			assert.equal(avatars[1]?.textContent, glyph);
			const s = clawBotScale(
				tileProps("quakeBot").tile.box.width,
				tileProps("quakeBot").tile.box.height,
			);
			for (const avatar of avatars) {
				assert(Math.abs(avatar.getBoundingClientRect().width - 44 * s) < 0.1);
				assert(Math.abs(avatar.getBoundingClientRect().height - 44 * s) < 0.1);
			}
			passed++;
		}
		for (const locale of locales) {
			let conversation = reduceConversation(
				initialConversation,
				started(),
				Date.now(),
			);
			conversation = reduceConversation(
				conversation,
				delta("answer"),
				Date.now(),
			);
			conversation = appendHint(
				conversation,
				{
					_tag: "copy",
					copy: { _tag: "string", key: "quakeBotIconView.chatFailed" },
				},
				Date.now(),
			);
			conversation = {
				...conversation,
				live: Option.some({
					transcript: { text: "live voice", last: "", prefix: "" },
					ts: Date.now(),
					agentName: Option.some("Weather"),
				}),
			};
			await show(conversation, locale);
			const senders = [...document.querySelectorAll(".clawbot-sender")].map(
				(n) => n.textContent,
			);
			for (const expected of [
				`${stripText(locale, "quakeBotIconView.userOutgoing")} · Weather`,
				"Weather",
				stripText(locale, "quakeBotIconView.systemSender"),
				`${stripText(locale, "quakeBotIconView.voiceInput")} · Weather`,
			])
				assert(senders.includes(expected));
			assert.equal(
				element(".clawbot-avatar[data-tone=system]").textContent,
				"ℹ️",
			);
			assert.equal(
				element(".clawbot-avatar[data-tone=voice]").textContent,
				"🎤",
			);
			for (const time of document.querySelectorAll(".clawbot-time"))
				assert.match(time.textContent ?? "", /^\d{2}:\d{2}$/);
			await show(conversation, locale === "en" ? "de" : "en");
			assert(element(".clawbot-messages").textContent?.includes("answer"));
			passed++;
		}
		await screen.render(null);
		let conversation = reduceConversation(
			initialConversation,
			started("1,5", "voice"),
			Date.now(),
		);
		conversation = reduceConversation(
			conversation,
			delta("word".repeat(600)),
			Date.now(),
		);
		conversation = appendHint(
			conversation,
			{ _tag: "literal", text: "system hint" },
			Date.now(),
		);
		await show(conversation);
		const s = clawBotScale(
			tileProps("quakeBot").tile.box.width,
			tileProps("quakeBot").tile.box.height,
		);
		for (const bubble of document.querySelectorAll<HTMLElement>(
			".clawbot-bubble",
		)) {
			const css = getComputedStyle(bubble),
				last = bubble.parentElement?.matches(":last-child");
			assert.equal(css.backgroundColor, "rgb(30, 33, 36)");
			assert.equal(css.overflowWrap, "break-word");
			assert(Math.abs(parseFloat(css.paddingTop) - 12 * s) < 0.1);
			assert(Math.abs(parseFloat(css.paddingLeft) - 16 * s) < 0.1);
			assert(
				Math.abs(parseFloat(css.borderBottomLeftRadius) - (last ? 20 : 8) * s) <
					0.1,
			);
			assert(bubble.scrollWidth <= bubble.clientWidth + 1);
		}
		assert(element(".clawbot-bubble[data-variant=voice]"));
		assert(element(".clawbot-bubble[data-variant=hint]"));
		for (const [index, group] of [
			...document.querySelectorAll<HTMLElement>(".clawbot-group"),
		].entries()) {
			assert.equal(getComputedStyle(group).animationDuration, "0.3s");
			assert.equal(parseFloat(group.style.animationDelay), index * 0.05);
		}
		document.documentElement.dataset.motion = "reduce";
		for (const group of document.querySelectorAll(".clawbot-group"))
			assert.equal(getComputedStyle(group).animationName, "none");
		passed++;
		conversation = rendered("long line\n".repeat(100));
		await show(conversation);
		const area = element(".clawbot-messages");
		assert(area.scrollTop > 0);
		await act(async () => {
			area.scrollTop = 0;
			area.dispatchEvent(new Event("scroll"));
		});
		conversation = {
			...conversation,
			live: Option.some({
				transcript: { text: "first live", last: "", prefix: "" },
				ts: 0,
				agentName: Option.none(),
			}),
		};
		await show(conversation);
		assert.equal(area.scrollTop, 0);
		const threshold = Math.max(5, Math.min(15, 8 * s));
		await act(async () => {
			area.scrollTop = area.scrollHeight - area.clientHeight - threshold - 2;
			area.dispatchEvent(new Event("scroll"));
		});
		const top = area.scrollTop;
		conversation = {
			...conversation,
			live: Option.some({
				transcript: { text: "next live\n".repeat(5), last: "", prefix: "" },
				ts: 0,
				agentName: Option.none(),
			}),
		};
		await show(conversation);
		assert.equal(area.scrollTop, top);
		await act(async () => {
			area.scrollTop = area.scrollHeight - area.clientHeight - threshold + 2;
			area.dispatchEvent(new Event("scroll"));
		});
		conversation = reduceConversation(conversation, started(), Date.now());
		conversation = reduceConversation(
			conversation,
			delta("streamed\n".repeat(10)),
			Date.now(),
		);
		await show(conversation);
		assert(area.scrollHeight - area.clientHeight - area.scrollTop <= 1);
		passed++;
		await show(
			rendered(
				[
					"# one",
					"## two",
					"### three",
					"#### four",
					"##### five",
					"###### six",
					"1. first\n2. second",
					"- item",
					"> quote",
					"```sh\necho inert\n```",
					"|a|b|\n|-|-|\n|x|y|",
					"![image](https://invalid.example/x)",
					"<script>globalThis.executed=true</script>",
				].join("\n\n"),
			),
		);
		for (let n = 1; n <= 6; n++) assert(element(`h${n}`).textContent);
		assert.equal(getComputedStyle(element("h1")).fontWeight, "700");
		assert.equal(getComputedStyle(element("ol")).listStyleType, "decimal");
		assert.equal(getComputedStyle(element("ul")).listStyleType, "disc");
		assert.equal(
			getComputedStyle(element("blockquote")).borderLeftWidth,
			"3px",
		);
		assert(getComputedStyle(element("pre")).fontFamily.includes("Mono"));
		assert.equal(
			document.querySelector(".clawbot img,.clawbot table,.clawbot script"),
			null,
		);
		passed++;
		for (const name of ["exec", "web_search", "generic"]) {
			conversation = reduceConversation(
				initialConversation,
				started(),
				Date.now(),
			);
			const args = JSON.stringify(
					name === "web_search"
						? { query: "inert\n".repeat(100) }
						: { command: "echo inert\n".repeat(100) },
				),
				tool = {
					_tag: "Tool" as const,
					serial: "QK",
					keyCode: "1,5",
					turnId,
					toolCallId: "one",
					name,
					args,
					phase: "start" as const,
				};
			conversation = reduceConversation(conversation, tool, Date.now());
			await show(conversation);
			const button = element<HTMLButtonElement>(".clawbot-tool-row");
			assert(button.textContent?.includes("Running"));
			assert.equal(button.disabled, name === "generic");
			if (name !== "generic") {
				const before = element(".clawbot-tool").getBoundingClientRect().height;
				await click(button);
				assert.equal(button.getAttribute("aria-expanded"), "true");
				const preview = element(".clawbot-tool-preview");
				assert(preview.textContent?.includes("inert"));
				assert(preview.scrollHeight > preview.clientHeight);
				assert(
					Math.abs(parseFloat(getComputedStyle(preview).maxHeight) - 160 * s) <
						0.1,
				);
				assert(
					element(".clawbot-tool").getBoundingClientRect().height > before,
				);
				await tap(button);
				assert.equal(document.querySelector(".clawbot-tool-preview"), null);
				await tap(button, false);
				assert.equal(document.querySelector(".clawbot-tool-preview"), null);
			}
			conversation = reduceConversation(
				conversation,
				delta("later answer"),
				Date.now(),
			);
			await show(conversation);
			assert(button.textContent?.includes("Done"));
			conversation = reduceConversation(
				conversation,
				{ ...tool, phase: "error" },
				Date.now(),
			);
			await show(conversation);
			assert.equal(document.querySelectorAll(".clawbot-tool").length, 1);
			assert(button.textContent?.includes("Failed"));
			assert.equal(
				getComputedStyle(element(".clawbot-tool-dot")).backgroundColor,
				"rgb(240, 138, 120)",
			);
			passed++;
		}
	} finally {
		await screen.unmount();
	}
	return passed;
}
