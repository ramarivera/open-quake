// The smoke entry never imports the application composition root, opens a
// device, or registers OS action adapters. It runs inside the packaged runtime.
export {};

if (process.argv.includes("--package-smoke")) {
	const { runPackageSmoke } = await import("./test/package-smoke");
	void runPackageSmoke();
} else {
	// Electron waits for this import before emitting ready. The production
	// root registers privileged media schemes before that event.
	await import("./index");
}
