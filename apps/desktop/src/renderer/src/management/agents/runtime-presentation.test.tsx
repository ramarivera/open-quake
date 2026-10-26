// @vitest-environment happy-dom
import { Schema } from "effect";
import { act } from "react";
import { expect, it, vi } from "vitest";
import { initialAgentState } from "../../../../../../../packages/edge/src/agents/agents-invariants";
import type {
	AgentReply,
	AgentsBridge,
	AgentView,
	RuntimeState,
} from "../../../../shared/agents";
import { AgentId } from "../../../../shared/agents";
import { AppLocaleProvider } from "../../i18n";
import { button, click, element, mount } from "../dom-test";
import { AgentsPage } from "./AgentsPage";
import { RuntimeIndicator } from "./RuntimeIndicator";
import type { AgentRequest } from "./useAgents";

const snapshot = (
	status: RuntimeState["status"],
	available = true,
): AgentView => ({
	...initialAgentState(),
	models: {},
	runtime: {
		available,
		status,
		code: status === "error" ? "AGENT.RUNTIME.FAILED" : "",
		operation: "start",
	},
	progress: { percent: 0, stage: "idle", deviceApplied: false },
	draftingAvailable: false,
});
it.each(["ready", "starting", "stopping", "stopped", "error"] as const)(
	"CENTER-020 renders and guards all lifecycle actions for %s",
	async (status) => {
		const request = vi.fn<AgentRequest>(async () => ({
			_tag: "success",
			view: snapshot(status),
			draft: "",
		}));
		await mount(
			<RuntimeIndicator runtime={snapshot(status).runtime} request={request} />,
		);
		const actions = [...document.querySelectorAll<HTMLButtonElement>("button")];
		expect(actions).toHaveLength(3);
		expect(actions.map((a) => a.disabled)).toEqual([
			status === "ready" || status === "starting" || status === "stopping",
			status !== "ready",
			status !== "ready",
		]);
		for (const action of actions) await click(action);
		expect(request).toHaveBeenCalledTimes(
			status === "ready"
				? 2
				: status === "error" || status === "stopped"
					? 1
					: 0,
		);
		if (status === "error")
			expect(element("[role=alert]").textContent).toContain(
				"AGENT.RUNTIME.FAILED",
			);
	},
);
it("CENTER-020 unavailable controls remain visible and never dispatch", async () => {
	const request = vi.fn<AgentRequest>();
	await mount(
		<RuntimeIndicator
			runtime={snapshot("stopped", false).runtime}
			request={request}
		/>,
	);
	for (const action of document.querySelectorAll<HTMLButtonElement>("button")) {
		expect(action.disabled).toBe(true);
		await click(action);
	}
	expect(request).not.toHaveBeenCalled();
});
it("CENTER-012/022/024/025/026/028 keeps the latest runtime event over a delayed equal-revision read and unsubscribes", async () => {
	let resolveRead: (reply: AgentReply) => void = () => {};
	let receive: (view: AgentView) => void = () => {};
	const off = vi.fn();
	const bridge: AgentsBridge = {
		request: vi.fn<AgentRequest>(
			() =>
				new Promise<AgentReply>((resolve) => {
					resolveRead = resolve;
				}),
		),
		onSnapshot: (listener) => {
			receive = listener;
			return off;
		},
		onProgress: () => off,
	};
	const mounted = await mount(<AgentsPage bridge={bridge} />);
	expect(element("[data-session-mode]").getAttribute("data-session-mode")).toBe(
		"detecting",
	);
	await act(async () => receive(snapshot("ready")));
	expect(element(".aw-header .aw-runtime").getAttribute("data-runtime")).toBe(
		"ready",
	);
	expect(element("[data-session-mode]").getAttribute("data-session-mode")).toBe(
		"ready",
	);
	await act(async () =>
		receive({
			...snapshot("stopped"),
			agents: [
				...snapshot("stopped").agents,
				{
					id: Schema.decodeUnknownSync(AgentId)("other"),
					emoji: "",
					files: {},
					name: "Other",
				},
			],
		}),
	);
	await act(async () =>
		resolveRead({ _tag: "success", view: snapshot("ready"), draft: "" }),
	);
	expect(element("[data-session-mode]").getAttribute("data-session-mode")).toBe(
		"offline",
	);
	expect(element(".aw-session-count").textContent).toContain("2");
	await click(button("Refresh", element(".aw-session-runtime")));
	expect(bridge.request).toHaveBeenCalledTimes(2);
	await mounted.unmount();
	expect(off).toHaveBeenCalledTimes(2);
	await act(async () => receive(snapshot("ready")));
	expect(document.querySelector(".aw-runtime")).toBeNull();
});
it("CENTER-042 only shows the inert diagnostic card when the explicit gate is on", async () => {
	const bridge: AgentsBridge = {
		request: async () => ({
			_tag: "success",
			view: snapshot("stopped", false),
			draft: "",
		}),
		onSnapshot: () => () => {},
		onProgress: () => () => {},
	};
	const off = await mount(
		<AgentsPage bridge={bridge} developmentDiagnostics={false} />,
	);
	expect(
		document.querySelector('[aria-label="Local model diagnostic"]'),
	).toBeNull();
	await off.unmount();
	await mount(<AgentsPage bridge={bridge} developmentDiagnostics />);
	expect(
		element('[aria-label="Local model diagnostic"]').textContent,
	).toContain("deprecated");
	expect(
		element('[aria-label="Local model diagnostic"]').querySelectorAll("button"),
	).toHaveLength(0);
});
it.each(["en", "de"] as const)(
	"CENTER-055 displays four loading rows with localized roster labels in %s",
	async (locale) => {
		const bridge: AgentsBridge = {
			request: () => new Promise(() => {}),
			onSnapshot: () => () => {},
			onProgress: () => () => {},
		};
		await mount(
			<AppLocaleProvider initialLocale={locale} bridge={null}>
				<AgentsPage bridge={bridge} initialTab="agents" />
			</AppLocaleProvider>,
			false,
		);
		const label =
			locale === "de" ? "Agenten werden geladen…" : "Loading agents…";
		expect(element(".aw-rows").getAttribute("aria-label")).toBe(label);
		expect(element("section[aria-busy=true]").getAttribute("aria-label")).toBe(
			label,
		);
		expect(element("section[aria-busy=true] [role=status]").textContent).toBe(
			label,
		);
		expect(document.querySelectorAll(".aw-skeleton")).toHaveLength(4);
	},
);
