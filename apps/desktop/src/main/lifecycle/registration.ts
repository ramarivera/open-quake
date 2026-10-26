import { Effect, Schema } from "effect";
import { type BrowserWindow, ipcMain } from "electron";
import {
	LIFECYCLE_CHANNEL,
	LifecycleCommand,
	type LifecycleReply,
} from "../../shared/lifecycle-contracts";
import type { DesktopRuntime } from "../diagnostics/module";
import { canRequestWallpaper } from "../media/media-permissions";
import { DeviceLifecycle } from "./lifecycle-service";

export function canRequestLifecycle(
	caller: string,
	renderer: string,
	mainFrame: boolean,
	management: boolean,
	input: unknown,
): boolean {
	return (
		mainFrame &&
		management &&
		canRequestWallpaper(caller, renderer, input, true)
	);
}
export function registerLifecycle(
	runtime: DesktopRuntime<DeviceLifecycle, never>,
	management: () => BrowserWindow,
	renderer: string,
): (() => void) & { bindManagement(): void } {
	ipcMain.handle(
		LIFECYCLE_CHANNEL,
		async (event, input: unknown): Promise<LifecycleReply> => {
			if (
				!canRequestLifecycle(
					event.sender.getURL(),
					renderer,
					event.senderFrame === event.sender.mainFrame,
					event.sender === management().webContents,
					input,
				)
			)
				return { ok: false, code: "DESKTOP.LIFECYCLE.FORBIDDEN" };
			if (!Schema.is(LifecycleCommand)(input))
				return { ok: false, code: "DESKTOP.LIFECYCLE.INVALID" };
			return runtime.runPromise(
				Effect.gen(function* () {
					const lifecycle = yield* DeviceLifecycle;
					switch (input.action) {
						case "bind-all":
						case "restart":
							if (
								!(yield* lifecycle.rebind(
									input.action === "restart" ? input.serial : undefined,
								))
							)
								return {
									ok: false,
									code: "DESKTOP.LIFECYCLE.INVALID",
								} satisfies LifecycleReply;
							break;
						case "redetect":
							yield* lifecycle.redetect();
							break;
						case "repair-layout":
							yield* lifecycle.repair();
							break;
						case "display-settings":
							yield* lifecycle.openSettings();
							break;
						case "wizard":
							yield* lifecycle.wizard(input.open);
							break;
						case "read":
							break;
					}
					return {
						ok: true,
						status: lifecycle.status(),
					} satisfies LifecycleReply;
				}).pipe(
					Effect.catchTag("DisplayOperationFailed", () =>
						Effect.succeed<LifecycleReply>({
							ok: false,
							code: "DESKTOP.DISPLAY.OPERATION_FAILED",
						}),
					),
				),
			);
		},
	);
	const clearWizard = () => {
		void runtime.runPromise(
			DeviceLifecycle.pipe(
				Effect.flatMap((lifecycle) => lifecycle.wizard(false)),
			),
		);
	};
	let removeOwner = () => {};
	const bindManagement = () => {
		removeOwner();
		clearWizard();
		const owner = management().webContents;
		owner.on("did-start-loading", clearWizard);
		owner.on("destroyed", clearWizard);
		removeOwner = () => {
			owner.removeListener("did-start-loading", clearWizard);
			owner.removeListener("destroyed", clearWizard);
		};
	};
	bindManagement();
	return Object.assign(
		() => {
			ipcMain.removeHandler(LIFECYCLE_CHANNEL);
			removeOwner();
		},
		{ bindManagement },
	);
}
