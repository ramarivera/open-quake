// @vitest-environment happy-dom
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
	builtinProfiles,
	profileLabel,
	profileText,
} from "../../../../../../packages/device/src/profiles/profile-catalog";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../../packages/device/src/profiles/profile-contracts";
import { managerState } from "../../../../../../packages/device/src/profiles/profile-manager-invariants";
import { ProfileManager } from "../../../../../../packages/device/src/profiles/profile-manager-service";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../../packages/device/src/profiles/profile-service";
import {
	ProfileSwitching,
	ProfileSwitchingPort,
} from "../../../../../../packages/device/src/profiles/profile-switching-service";
import {
	EmojiRepository,
	emojiStorageLayer,
} from "../../../../../../packages/edge/src/emoji/emoji-repository";
import { EmojiLibrary } from "../../../../../../packages/edge/src/emoji/emoji-service";
import { integrationFixture } from "../../../main/integrations/test-fixtures";
import { makeProfileController } from "../../../main/profiles/profile-controller";
import type { EmojiBridge } from "../../../shared/emoji";
import type { IntegrationsBridge } from "../../../shared/integrations";
import type { KeyReply, KeyRequest } from "../../../shared/key-library";
import type { AppLocaleBridge, LocaleSnapshot } from "../../../shared/locale";
import type {
	ProfileReply,
	ProfileView,
} from "../../../shared/profile-manager";
import { button, click, input, mount, query, settle } from "../../test/dom";
import { App } from "../App";
import { AppLocaleProvider } from "../i18n";
import { ProfilesManager } from "./ProfileViews";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
async function fixture(
	platform: "darwin" | "win32" | "linux" = "win32",
	navigation = false,
) {
	vi.spyOn(navigator, "platform", "get").mockReturnValue(
		platform === "darwin"
			? "MacIntel"
			: platform === "win32"
				? "Win32"
				: "Linux",
	);
	const base = createInitialProfileEnvelope();
	let saved = encodeProfileEnvelope({
		...base,
		profiles: [
			{ ...base.profiles[0], id: "custom", name: "Custom" },
			...builtinProfiles(platform),
		],
		activeByDevice: {
			"desktop-preview": {
				profileId: "custom",
				pageId: base.profiles[0].pages[0].id,
			},
		},
	});
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(
			ProfileManager.DefaultWithoutDependencies,
			ProfileSwitching.DefaultWithoutDependencies,
			ProfileService.DefaultWithoutDependencies,
		).pipe(
			Layer.provideMerge(
				ProfileRepository.Default.pipe(
					Layer.provide(
						profileStorageLayer({
							read: async () => saved,
							write: async (e) => {
								saved = e;
							},
						}),
					),
				),
			),
			Layer.provide(
				Layer.succeed(ProfileSwitchingPort, {
					platform,
					foreground: () => Effect.succeed(Option.none()),
					push: () => Effect.void,
				}),
			),
		),
	);
	cleanup.push(() => runtime.dispose());
	let snapshot: ((v: ProfileView) => void) | undefined;
	let chosen = Option.none<string>();
	let captures = 0;
	const capture = vi.fn(
		async () => `data:image/png;base64,thumbnail${++captures}`,
	);
	const controller = await runtime.runPromise(
		makeProfileController({
			installedApps: async () => [
				{ name: "Editor", path: "/apps/editor", identifier: "editor.app" },
			],
			confirm: async () => true,
			execute: async () => {},
			chooseApp: async () => chosen,
			capture,
			cachedThumbnail: async () => Option.none(),
			publish: (v) => snapshot?.(v),
			progress: () => {},
		}),
	);
	const request = vi.fn(
		async (
			c: Parameters<typeof controller.request>[0],
		): Promise<ProfileReply> => {
			const result = await runtime.runPromise(
				Effect.either(controller.request(c)),
			);
			return result._tag === "Right"
				? result.right
				: { _tag: "rejected", reason: result.left.code };
		},
	);
	window.quakeProfileManager = {
		request,
		onSnapshot: (cb) => {
			snapshot = cb;
			return () => {
				snapshot = undefined;
			};
		},
		onProgress: () => () => {},
		onSelection: () => () => {},
	};
	if (navigation) {
		history.replaceState(null, "", "/?page=keys");
		vi.stubGlobal("quakeAgents", {
			request: async () => ({
				_tag: "rejected",
				message: "Runtime not configured",
			}),
			onSnapshot: () => () => {},
			onProgress: () => () => {},
		});
		const keyRequest = async (command: KeyRequest): Promise<KeyReply> => {
			if (command.type === "select")
				await runtime.runPromise(
					ProfileService.selectProfile({
						deviceId: command.deviceId,
						profileId: command.profileId,
						pageId: command.pageId,
					}),
				);
			return {
				_tag: "success",
				envelope: encodeProfileEnvelope(
					(await runtime.runPromise(ProfileService.loadProfiles())).envelope,
				),
			};
		};
		vi.stubGlobal("quakeKeyLibrary", {
			request: keyRequest,
			onPreview: () => () => {},
			onRuntime: () => () => {},
		});
		const integrations = integrationFixture();
		cleanup.push(integrations.dispose);
		const bridge: IntegrationsBridge = {
			request: integrations.request,
			onHaLive: () => () => {},
		};
		vi.stubGlobal("quakeIntegrations", bridge);
		const emoji = ManagedRuntime.make(
			EmojiLibrary.DefaultWithoutDependencies.pipe(
				Layer.provide(
					EmojiRepository.Default.pipe(
						Layer.provide(
							emojiStorageLayer({
								read: async () => null,
								write: async () => {},
							}),
						),
					),
				),
			),
		);
		cleanup.push(() => emoji.dispose());
		const emojiBridge: EmojiBridge = {
			request: async (command) => {
				if (command.type === "command")
					await emoji.runPromise(EmojiLibrary.command(command.command));
				return {
					_tag: "ready",
					store: await emoji.runPromise(EmojiLibrary.read()),
					assets: {},
					notice: "",
					apps: [],
				};
			},
			press: async () => ({ _tag: "ignored" }),
		};
		vi.stubGlobal("quakeEmoji", emojiBridge);
	}
	let locale: LocaleSnapshot = { locale: "en", revision: 0 };
	const listeners = new Set<(snapshot: LocaleSnapshot) => void>();
	const localeBridge: AppLocaleBridge = {
		read: async () => locale,
		set: async (value) => {
			locale = { locale: value, revision: locale.revision + 1 };
			for (const listener of listeners) listener(locale);
			return locale;
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose: async () => {},
	};
	const mounted = await mount(
		<AppLocaleProvider bridge={localeBridge}>
			{navigation ? <App /> : <ProfilesManager />}
		</AppLocaleProvider>,
	);
	cleanup.push(mounted.close);
	await settle(() =>
		navigation
			? expect(mounted.host.querySelector("#keys-profile")).not.toBeNull()
			: expect(mounted.host.querySelectorAll(".profile-row")).toHaveLength(
					platform === "darwin" ? 9 : 10,
				),
	);
	return {
		...mounted,
		runtime,
		controller,
		request,
		capture,
		saved: () => saved,
		choose: (path?: string) => {
			chosen = Option.fromNullable(path);
		},
		publish: async () => {
			await act(async () => {
				await runtime.runPromise(controller.publish());
			});
		},
	};
}

for (const platform of ["darwin", "win32", "linux"] as const)
	it(`MGMT-315 renders every default on ${platform}, localizes labels and exposes the selected profile settings`, async () => {
		const f = await fixture(platform);
		await input(query(f.host, "header select", HTMLSelectElement), "de");
		const defaults = builtinProfiles(platform).filter(
			(p) => platform !== "darwin" || p.id !== "1-0",
		);
		const rows = f.host.querySelectorAll(
			".profile-columns > div:first-child .profile-row",
		);
		expect(rows).toHaveLength(defaults.length);
		for (const [index, p] of defaults.entries()) {
			const row = rows[index];
			if (!row) throw new Error("Missing default row");
			expect(row.textContent).toContain(profileLabel(p, "de"));
			expect(row.querySelector('input[type="checkbox"]')).not.toBeNull();
			expect(query(row, ".profile-select", HTMLButtonElement).disabled).toBe(
				false,
			);
		}
		const quick = defaults.find((p) => p.id === "1-2");
		if (!quick) throw new Error("Missing Quick");
		await click(button(f.host, profileLabel(quick, "de")));
		expect(
			f.host.querySelector(".profile-settings legend")?.textContent,
		).toContain(profileLabel(quick, "de"));
		expect(f.host.querySelector(`[data-profile-ready="1-2"]`)).not.toBeNull();
		expect(f.saved().profiles.find((p) => p.id === "1-2")?.name).toBe("Quick");
	});

it("MGMT-317 selects, duplicates, refreshes the thumbnail and deletes a custom profile through the controller", async () => {
	const f = await fixture();
	const custom = () =>
		query(
			f.host,
			".profile-columns > div:nth-child(2) .profile-row",
			HTMLLIElement,
		);
	await click(query(custom(), ".profile-select", HTMLButtonElement));
	expect(custom().getAttribute("data-selected")).toBe("true");
	await click(
		button(
			custom(),
			`${profileText("functionWheelEditor.thumbnailUpdate")} Custom`,
		),
	);
	expect(query(custom(), "img", HTMLImageElement).src).toContain("thumbnail1");
	await click(button(custom(), "Duplicate Custom"));
	expect(f.saved().profiles.filter((p) => !p.id.startsWith("1-"))).toHaveLength(
		2,
	);
	vi.stubGlobal(
		"confirm",
		vi.fn(() => false),
	);
	await click(button(f.host, "Delete Custom"));
	expect(f.saved().profiles.some((p) => p.id === "custom")).toBe(true);
	vi.stubGlobal(
		"confirm",
		vi.fn(() => true),
	);
	await click(button(f.host, "Delete Custom"));
	expect(f.saved().profiles.some((p) => p.id === "custom")).toBe(false);
});

it("MGMT-319 commits weighted inline names on Enter and blur, and reverts invalid or duplicate names", async () => {
	const f = await fixture();
	let field = query(
		f.host,
		'input[aria-label="Rename Custom"]',
		HTMLInputElement,
	);
	field.focus();
	await input(field, "中文abcdex");
	expect(field.value).toBe("中文abcdex");
	expect(field.parentElement?.textContent).toContain("10/10");
	await act(async () =>
		field.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		),
	);
	await settle(() =>
		expect(f.saved().profiles.find((p) => p.id === "custom")?.name).toBe(
			"中文abcdex",
		),
	);
	field = query(
		f.host,
		'input[aria-label="Rename 中文abcdex"]',
		HTMLInputElement,
	);
	for (const value of ["", "Quick"]) {
		field.focus();
		await input(field, value);
		await act(async () => field.blur());
		expect(field.value).toBe("中文abcdex");
		expect(f.saved().profiles.find((p) => p.id === "custom")?.name).toBe(
			"中文abcdex",
		);
	}
	field.focus();
	await input(field, "Renamed");
	await act(async () => field.blur());
	expect(f.saved().profiles.find((p) => p.id === "custom")?.name).toBe(
		"Renamed",
	);
});

it("MGMT-330 links installed and manually selected apps with the device scope, and cancellation preserves the prior link", async () => {
	const f = await fixture();
	const selects = f.host.querySelectorAll<HTMLSelectElement>(
		".profile-settings select",
	);
	const device = selects[0],
		app = selects[1];
	if (!device || !app) throw new Error("Missing property selectors");
	await input(app, "/apps/editor");
	expect(
		managerState(await f.runtime.runPromise(ProfileManager.read())).links[0],
	).toMatchObject({
		profileId: "custom",
		appPath: "/apps/editor",
		appIdentifier: "editor.app",
	});
	f.choose("/Applications/My Editor.app");
	await input(app, "other");
	expect(f.saved().manager?.links[0]?.appIdentifier).toBe("My Editor");
	expect(app.selectedOptions[0]?.textContent).toBe("My Editor");
	f.choose();
	await input(app, "other");
	expect(f.saved().manager?.links[0]?.appPath).toBe(
		"/Applications/My Editor.app",
	);
	await input(app, "");
	expect(f.saved().manager?.links).toEqual([]);
});

it("MGMT-317 refreshes selected properties after an external profile rename publication", async () => {
	const f = await fixture();
	await f.runtime.runPromise(
		Effect.gen(function* () {
			const manager = yield* ProfileManager;
			yield* manager.command({
				type: "rename",
				id: "custom",
				name: "External",
			});
		}),
	);
	await f.publish();
	expect(
		f.host.querySelector(".profile-settings legend")?.textContent,
	).toContain("External");
	expect(button(f.host, "Delete External")).toBeDefined();
});

it("keeps retained thumbnail pixels stale until a capture with the requested border style arrives", async () => {
	const storageKey = "open-quake.strip.v1";
	const savedSettings = localStorage.getItem(storageKey);
	localStorage.setItem(
		storageKey,
		JSON.stringify({ version: 1, showEmptyGridDashedBorder: true }),
	);
	cleanup.push(async () => {
		if (savedSettings === null) localStorage.removeItem(storageKey);
		else localStorage.setItem(storageKey, savedSettings);
	});
	const f = await fixture();
	const cell = () =>
		query(f.host, '[data-profile-id="custom"]', HTMLDivElement);
	await click(
		button(
			cell(),
			`${profileText("functionWheelEditor.thumbnailUpdate")} Custom`,
		),
	);
	const original = query(cell(), "img", HTMLImageElement).src;
	expect(cell().getAttribute("data-state")).toBe("ready");
	const dispatch = f.request.getMockImplementation();
	if (!dispatch) throw new Error("Missing profile request fixture");
	let releaseStyle: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		releaseStyle = resolve;
	});
	const pending: Promise<ProfileReply>[] = [];
	f.request.mockImplementation((command) => {
		if (command.type !== "thumbnail-style" || command.showEmptyGridDashedBorder)
			return dispatch(command);
		const reply = gate.then(() => dispatch(command));
		pending.push(reply);
		return reply;
	});
	f.capture.mockRejectedValue(new Error("Capture unavailable"));
	cleanup.push(async () => {
		await act(async () => {
			releaseStyle?.();
			await Promise.all(pending);
		});
	});
	await act(async () => {
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: storageKey,
				newValue: JSON.stringify({
					version: 1,
					showEmptyGridDashedBorder: false,
				}),
			}),
		);
	});
	expect(pending.length).toBeGreaterThan(0);
	expect(cell().getAttribute("data-state")).toBe("stale");
	expect(query(cell(), "img", HTMLImageElement).src).toBe(original);
	await act(async () => {
		releaseStyle?.();
		await Promise.all(pending);
	});
	expect(cell().getAttribute("data-state")).toBe("stale");
	expect(query(cell(), "img", HTMLImageElement).src).toBe(original);
	// Identical replacement bytes still have a newly confirmed capture identity.
	f.capture.mockResolvedValue(original);
	await act(async () => {
		await f.request({
			type: "thumbnail-style",
			showEmptyGridDashedBorder: false,
		});
	});
	expect(cell().getAttribute("data-state")).toBe("ready");
	expect(query(cell(), "img", HTMLImageElement).src).toBe(original);
});

for (const platform of ["win32", "linux"] as const)
	it(`MGMT-382 dispatches the exact ${platform} settings command only after native approval`, async () => {
		const f = await fixture(platform);
		const command =
			platform === "win32"
				? "start control"
				: "gnome-control-center || xfce4-settings-manager || systemsettings5 || unity-control-center";
		const confirm = vi.fn(async () => false),
			execute = vi.fn<(_command: string) => Promise<void>>(async () => {});
		const controller = await f.runtime.runPromise(
			makeProfileController({
				confirm,
				execute,
				chooseApp: async () => Option.none(),
				capture: async () => "",
				cachedThumbnail: async () => Option.none(),
				publish: () => {},
				progress: () => {},
			}),
		);
		expect(
			await f.runtime.runPromise(
				controller.request({ type: "run-command", id: "1-2", keyCode: "2,8" }),
			),
		).toEqual({ _tag: "rejected", reason: "cancelled" });
		expect(confirm).toHaveBeenCalledWith("Run command?", command);
		expect(execute).not.toHaveBeenCalled();
		confirm.mockResolvedValue(true);
		for (let i = 0; i < 2; i++)
			expect(
				(
					await f.runtime.runPromise(
						controller.request({
							type: "run-command",
							id: "1-2",
							keyCode: "2,8",
						}),
					)
				)._tag,
			).toBe("success");
		expect(confirm).toHaveBeenCalledTimes(2);
		expect(execute.mock.calls).toEqual([[command], [command]]);
	});

it("MGMT-313 navigates from Keys through the real manager and returns with the selected resource/device", async () => {
	const f = await fixture("win32", true);
	expect(query(f.host, "#keys-profile", HTMLSelectElement).value).toBe(
		"custom",
	);
	await click(button(f.host, "Knob profiles"));
	await settle(() =>
		expect(f.host.querySelector(".profile-settings")).not.toBeNull(),
	);
	await click(button(f.host, "Quick"));
	expect(f.saved().activeByDevice["desktop-preview"]).toMatchObject({
		profileId: "1-2",
		pageId: "1",
	});
	await click(button(f.host, "Keys"));
	await settle(() =>
		expect(query(f.host, "#keys-profile", HTMLSelectElement).value).toBe("1-2"),
	);
});

it("MGMT-118 reaches actual emoji package and shortcut creation workflows from Keys", async () => {
	const f = await fixture("win32", true);
	await click(button(f.host, "AI emoji"));
	await settle(() =>
		expect(f.host.textContent).toContain("Create your first emoji pack"),
	);
	await click(button(f.host, "New Package"));
	await settle(() =>
		expect(f.host.querySelector('input[value="Unnamed Pack"]')).not.toBeNull(),
	);
	await click(button(f.host, "AI shortcuts"));
	await settle(() =>
		expect(button(f.host, "Add shortcut").disabled).toBe(false),
	);
	await click(button(f.host, "Add shortcut"));
	expect(
		Array.from(f.host.querySelectorAll("input")).some(
			(field) => field.value === "Shortcut 1",
		),
	).toBe(true);
	await click(button(f.host, "Keys"));
	await settle(() =>
		expect(query(f.host, "#keys-profile", HTMLSelectElement).value).toBe(
			"custom",
		),
	);
});
