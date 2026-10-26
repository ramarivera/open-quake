// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { ConnectionDiagnostic } from "../../../shared/lifecycle-contracts";
import { useOrientation } from "./SetupWizard";

it("SETTINGS-090 ignores stale ready orientation after a lifecycle update and disposes the selected serial", async () => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	let release: (reply: unknown) => void = () => {};
	let publish: (status: ConnectionDiagnostic) => void = () => {};
	const off = vi.fn();
	const read = vi.fn(
		() =>
			new Promise<unknown>((resolve) => {
				release = resolve;
			}),
	);
	vi.stubGlobal("quakeDeviceReady", { read });
	vi.stubGlobal("quakeLifecycle", {
		onStatus: (callback: typeof publish) => {
			publish = callback;
			return off;
		},
		request: () => new Promise(() => {}),
	});
	function View({ serial }: { serial: string }) {
		const value = useOrientation(serial);
		return (
			<output>
				{value?.serialNumber}:{value?.rotation}
			</output>
		);
	}
	const node = document.createElement("div");
	document.body.append(node);
	const root = createRoot(node);
	try {
		await act(async () => {
			root.render(<View serial="A" />);
		});
		expect(read).toHaveBeenCalledWith("A");
		await act(async () => {
			publish({
				usb: "pass",
				hdmi: "pass",
				checking: false,
				mock: true,
				width: 480,
				height: 1920,
				resolutionMismatch: false,
				issue: "none",
				orientations: [
					{
						serialNumber: "A",
						rotation: 90,
						isVertical: true,
						orientation: "vertical",
						connected: true,
					},
				],
			});
		});
		await act(async () => {
			release({
				_tag: "ready",
				snapshot: {
					serialNumber: "A",
					connected: true,
					deviceModel: "QUAKE_HID",
					connectionType: "mock",
					rotation: 270,
					keyMatrix: { row: 2, col: 8 },
					session: "A",
				},
			});
		});
		expect(node.textContent).toBe("A:90");
		await act(async () => {
			root.render(<View serial="unknown" />);
		});
		expect(node.textContent).toBe(":");
		expect(read).toHaveBeenLastCalledWith("unknown");
		await act(async () => {
			release({ _tag: "offline" });
		});
		expect(node.textContent).toBe(":");
	} finally {
		await act(async () => {
			root.unmount();
		});
		node.remove();
		vi.unstubAllGlobals();
	}
	expect(off).toHaveBeenCalledTimes(2);
});
