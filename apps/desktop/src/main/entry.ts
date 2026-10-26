// The smoke entry never imports the application composition root, opens a
// device, or registers OS action adapters. It runs inside the packaged runtime.
import { app } from "electron";
import {
	startTestParentGuard,
	validateDeviceTestPolicy,
} from "./device-test-policy";

validateDeviceTestPolicy(app.isPackaged, process.env);
const stopGuard = startTestParentGuard({
	enabled: process.env.OPEN_QUAKE_E2E === "1",
	parent: () => process.ppid,
	quit: () => app.quit(),
	schedule: (check, interval) => {
		const timer = setInterval(check, interval);
		timer.unref();
		return () => clearInterval(timer);
	},
});
app.once("will-quit", stopGuard);

if (process.argv.includes("--package-smoke")) {
	const { runPackageSmoke } = await import("./test/package-smoke");
	void runPackageSmoke();
} else {
	// Electron waits for this import before emitting ready. The production
	// root registers privileged media schemes before that event.
	await import("./index");
}
