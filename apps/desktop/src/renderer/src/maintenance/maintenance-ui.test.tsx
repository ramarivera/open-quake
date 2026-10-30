// @vitest-environment happy-dom
import { act, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
	type FirmwareSnapshot,
	idleFirmware,
	type MaintenanceCommand,
	type MaintenanceView,
} from "../../../shared/maintenance-contracts";
import { button, click, mount, query } from "../../test/dom";
import { firmwareReason } from "./firmware-guidance";
import { AppUpdateDialog, FirmwareDialog, SettingsPage } from "./SettingsPage";
import { type MaintenanceController, useMaintenance } from "./useMaintenance";

vi.mock("../speech/SpeechSettings", () => ({
	SpeechSettingsPanel: () => null,
}));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0).reverse()) await close();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
function view(firmware: FirmwareSnapshot = idleFirmware): MaintenanceView {
	return {
		firmware,
		currentVersion: "1.0.19",
		serial: "chosen",
		imageVersion: "1.0.21",
		imageTrusted: true,
		permissions: [],
		macOS: false,
		appVersion: "0.0.0",
		firmwareAvailability: "newer_bundled",
		update: {
			state: "disabled",
			version: "",
			progress: 0,
			reason: "",
			prompt: false,
		},
	};
}
function controller(v: MaintenanceView): MaintenanceController {
	return {
		view: v,
		error: "",
		message: "",
		busy: false,
		dialog: true,
		toast: "",
		request: vi.fn(async () => {}),
		openDialog: vi.fn(),
		closeDialog: vi.fn(),
	};
}
async function render(
	c: MaintenanceController,
	component: "firmware" | "update" | "settings" = "firmware",
) {
	const ui = await mount(
		component === "firmware" ? (
			<FirmwareDialog controller={c} />
		) : component === "update" ? (
			<AppUpdateDialog controller={c} />
		) : (
			<SettingsPage controller={c} />
		),
	);
	cleanups.push(ui.close);
	return ui;
}
for (const [state, step] of [
	["checking", 0],
	["entering_download_mode", 0],
	["waiting_volume", 1],
	["ready_to_write", 1],
	["copying", 2],
	["written_unverified", 2],
	["verifying", 3],
	["success", 3],
	["failed", 2],
	["needs_recovery", 2],
] as const) {
	it(`renders four firmware steps and progress for ${state}`, async () => {
		const c = controller(
			view({
				...idleFirmware,
				state,
				step,
				from: "1.0.19",
				to: "1.0.21",
				copied: 512,
				total: 1024,
				reason: state === "failed" ? "dfu_volume_timeout" : "",
				volumes: [
					{ id: "a", label: "Synthetic A" },
					{ id: "b", label: "Synthetic B" },
				],
			}),
		);
		const { host } = await render(c);
		expect(host.querySelectorAll(".firmware-steps li")).toHaveLength(4);
		expect(host.textContent).toContain("1.0.19 → 1.0.21");
		expect(host.textContent).toContain("50%");
		if (["copying", "success", "failed", "needs_recovery"].includes(state))
			expect(query(host, "progress", HTMLProgressElement).value).toBe(50);
		else
			expect(
				host.querySelector('.firmware-indeterminate[role="progressbar"]'),
			).not.toBeNull();
		if (state === "success")
			expect(host.querySelectorAll('[data-state="done"]')).toHaveLength(4);
		if (state === "failed" || state === "needs_recovery")
			expect(host.querySelectorAll('[data-state="failed"]')).toHaveLength(1);
		if (state === "ready_to_write") {
			await click(button(host, "Write to Synthetic B"));
			expect(c.request).toHaveBeenCalledWith({
				action: "firmware-write",
				volumeId: "b",
			});
			await click(button(host, "Cancel before write"));
			expect(c.request).toHaveBeenCalledWith({ action: "firmware-cancel" });
		}
		await click(button(host, "Close firmware upgrade"));
		expect(c.closeDialog).toHaveBeenCalledOnce();
		await act(async () =>
			query(host, "dialog", HTMLDialogElement).dispatchEvent(
				new Event("cancel", { cancelable: true }),
			),
		);
		expect(c.closeDialog).toHaveBeenCalledTimes(2);
	});
}
for (const reason of [
	"device_disconnected",
	"no_device",
	"no_bundled_firmware",
	"up_to_date",
	"enter_download_mode_failed",
	"dfu_volume_timeout",
	"copy_failed",
	"verify_timeout",
	"version_mismatch",
	"interrupted",
	"cancelled_before_write",
	"QUAKE.FIRMWARE.IMAGE_INVALID",
	"QUAKE.FIRMWARE.TARGET_MISMATCH",
	"QUAKE.FIRMWARE.VOLUME_INVALID",
	"QUAKE.FIRMWARE.WRITE_FAILED",
	"QUAKE.FIRMWARE.VERIFICATION_FAILED",
	"QUAKE.FIRMWARE.UNAVAILABLE",
	"QUAKE.FIRMWARE.BUSY",
	"QUAKE.FIRMWARE.PERSIST_FAILED",
]) {
	it(`shows readable stage guidance for ${reason}`, async () => {
		const c = controller(
			view({
				...idleFirmware,
				state:
					reason === "copy_failed" || reason === "interrupted"
						? "needs_recovery"
						: "failed",
				reason,
				from: "1.0.19",
				to: "1.0.21",
			}),
		);
		const { host } = await render(c);
		expect(host.textContent).toContain(
			firmwareReason(reason, "1.0.19", "1.0.21"),
		);
		expect(host.querySelector('[role="status"]')?.textContent).not.toContain(
			reason,
		);
		expect(host.textContent).not.toMatch(/\{(?:current|expected)\}/);
	});
}
it("renders offline retained current-to-bundled version and requires online idle target to Upgrade", async () => {
	const c = controller({
		...view(),
		serial: "",
		firmwareAvailability: "no_device",
	});
	const { host } = await render(c, "settings");
	expect(host.textContent).toContain("1.0.19");
	expect(host.textContent).toContain("1.0.21");
	expect(host.textContent).toContain("Device not connected");
	expect(button(host, "Upgrade").disabled).toBe(true);
});
it("preserves app-owned progress across tabs and close/reopen with 1000ms reconciliation and a six-second terminal toast", async () => {
	vi.useFakeTimers();
	let next = view({
		...idleFirmware,
		state: "copying",
		step: 2,
		serial: "chosen",
		copied: 100,
		total: 1000,
	});
	const request = vi.fn(async (_command: MaintenanceCommand) => ({
		ok: true as const,
		view: next,
		message: "",
	}));
	vi.stubGlobal("quakeMaintenance", { request });
	function App() {
		const c = useMaintenance();
		const [tab, setTab] = useState(true);
		return (
			<>
				<button type="button" onClick={() => setTab(!tab)}>
					Switch tab
				</button>
				{tab ? <SettingsPage controller={c} /> : <p>Other tab</p>}
				<button type="button" onClick={c.openDialog}>
					Reopen
				</button>
				<FirmwareDialog controller={c} />
				<output>{c.toast}</output>
			</>
		);
	}
	const ui = await mount(<App />);
	cleanups.push(ui.close);
	expect(ui.host.querySelector("dialog")).not.toBeNull();
	await click(button(ui.host, "Switch tab"));
	await click(button(ui.host, "Close firmware upgrade"));
	expect(request).toHaveBeenCalledWith({ action: "firmware-close" });
	const before = request.mock.calls.length;
	await act(async () => {
		await vi.advanceTimersByTimeAsync(999);
	});
	expect(request).toHaveBeenCalledTimes(before);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1);
	});
	expect(request).toHaveBeenCalledTimes(before + 1);
	await click(button(ui.host, "Reopen"));
	expect(ui.host.textContent).toContain("10%");
	await click(button(ui.host, "Close firmware upgrade"));
	next = view({ ...next.firmware, state: "success", to: "1.0.21" });
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1000);
	});
	expect(ui.host.querySelector("output")?.textContent).toContain(
		"Firmware upgraded",
	);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(5999);
	});
	expect(ui.host.querySelector("output")?.textContent).not.toBe("");
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1);
	});
	expect(ui.host.querySelector("output")?.textContent).toBe("");
	expect(
		request.mock.calls.every(
			([command]) =>
				command.action !== "firmware-start" &&
				command.action !== "firmware-write",
		),
	).toBe(true);
});
it("restores a terminal session after controller remount", async () => {
	vi.stubGlobal("quakeMaintenance", {
		request: async () => ({
			ok: true,
			view: view({
				...idleFirmware,
				state: "needs_recovery",
				reason: "interrupted",
			}),
			message: "",
		}),
	});
	function App() {
		const c = useMaintenance();
		return <FirmwareDialog controller={c} />;
	}
	const ui = await mount(<App />);
	cleanups.push(ui.close);
	expect(ui.host.textContent).toContain("Update unverified");
});
for (const state of ["available", "downloading", "ready", "failed"] as const) {
	it(`routes app updater ${state} interactions and readable failure`, async () => {
		const c = controller({
			...view(),
			update: {
				state,
				version: "1.1.0",
				progress: 0.5,
				reason: state === "failed" ? "QUAKE.APP.UPDATE_FAILED" : "",
				prompt: true,
			},
		});
		const { host } = await render(c, "update");
		await click(button(host, "Install later"));
		expect(c.request).toHaveBeenCalledWith({ action: "defer-update" });
		if (state === "downloading") {
			expect(query(host, "progress", HTMLProgressElement).value).toBe(0.5);
			expect(button(host, "Install now").disabled).toBe(true);
		} else {
			await click(button(host, "Install now"));
			expect(c.request).toHaveBeenCalledWith({
				action: state === "ready" ? "install-update" : "download-update",
			});
		}
		if (state === "failed") {
			expect(host.textContent).toContain("Upgrade failed, please retry later.");
			expect(host.textContent).not.toContain("QUAKE.APP");
		}
	});
}
it("subscribes for the controller lifetime and does not let a delayed read overwrite a newer progress event", async () => {
	let receive: (snapshot: FirmwareSnapshot) => void = () => {};
	const off = vi.fn();
	let resolve: (reply: unknown) => void = () => {};
	const delayed = new Promise<unknown>((done) => {
		resolve = done;
	});
	const request = vi.fn().mockResolvedValue({
		ok: true,
		view: view({ ...idleFirmware, state: "copying", serial: "chosen" }),
		message: "",
	});
	vi.stubGlobal("quakeMaintenance", {
		request,
		subscribeFirmware: (listener: typeof receive) => {
			receive = listener;
			return off;
		},
	});
	function App() {
		const c = useMaintenance();
		return (
			<>
				<button
					type="button"
					onClick={() => void c.request({ action: "read" })}
				>
					Read
				</button>
				<FirmwareDialog controller={c} />
			</>
		);
	}
	const ui = await mount(<App />);
	request.mockReturnValueOnce(delayed);
	await click(button(ui.host, "Read"));
	await act(async () =>
		receive({ ...idleFirmware, state: "verifying", step: 3, serial: "chosen" }),
	);
	await act(async () => {
		resolve({
			ok: true,
			view: view({ ...idleFirmware, state: "copying", step: 2 }),
			message: "",
		});
		await delayed;
	});
	expect(
		ui.host.querySelectorAll('.firmware-steps [data-state="done"]'),
	).toHaveLength(3);
	await ui.close();
	expect(off).toHaveBeenCalledOnce();
});

for (const reason of ["QUAKE.APP.UPDATE_FAILED", ""]) {
	it(`announces app update failure once with ${reason || "only a request error"}`, async () => {
		const c = controller({
			...view(),
			update: {
				state: "failed",
				version: "1.1.0",
				progress: 0,
				reason,
				prompt: true,
			},
		});
		const { host } = await render(
			{ ...c, error: "Upgrade failed, please retry later." },
			"update",
		);
		expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1);
	});
}

it("SETTINGS-005 marks both destructive reset actions with the shared danger treatment and preserves Cancel", async () => {
	const c = controller(view());
	const { host } = await render(c, "settings");
	const reset = host.querySelector<HTMLButtonElement>(
		".maintenance-danger button",
	);
	if (!reset) throw new Error("Reset entry missing");
	expect(reset.dataset.variant).toBe("danger");
	await click(reset);
	const dialog = query(host, "dialog", HTMLDialogElement);
	const destructive = dialog.querySelector<HTMLButtonElement>(
		'[data-variant="danger"]',
	);
	if (!destructive) throw new Error("Destructive confirmation missing");
	expect(destructive.textContent).toContain("Without Backup");
	const cancel = [...dialog.querySelectorAll("button")].find((item) =>
		item.textContent?.includes("Cancel"),
	);
	if (!cancel) throw new Error("Cancel missing");
	await click(cancel);
	expect(host.querySelector("dialog")).toBeNull();
	expect(c.request).not.toHaveBeenCalled();
});
