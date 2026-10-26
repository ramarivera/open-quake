const { version } = require("./package.json");

/** @type {import('electron-builder').Configuration} */
module.exports = {
	appId: "net.roxasroot.open-quake",
	productName: "open-quake",
	// electron-builder expands these placeholders, JavaScript must leave them literal.
	artifactName: [
		"open-quake",
		"$" + "{version}",
		"$" + "{os}",
		"$" + "{arch}." + "$" + "{ext}",
	].join("-"),
	extraMetadata: { version: process.env.RELEASE_VERSION || version },
	directories: { output: "dist" },
	files: ["out/**/*", "package.json"],
	asar: true,
	asarUnpack: [
		"out/native-media/**/*",
		"node_modules/node-hid/**/*",
		"node_modules/koffi/**/*",
		"node_modules/@koromix/**/*",
	],
	// Both bindings use Node-API and ship native prebuilds. The packaged smoke
	// loads those bindings with the target Electron on every native runner.
	npmRebuild: false,
	publish: null,
	mac: {
		target: ["dmg", "zip"],
		category: "public.app-category.utilities",
		identity: "-",
		hardenedRuntime: false,
		notarize: false,
		extendInfo: {
			NSMicrophoneUsageDescription:
				"Record voice commands and meeting audio when you start capture.",
			NSAudioCaptureUsageDescription:
				"Capture meeting audio when you start a recording.",
		},
	},
	win: { target: ["nsis"] },
	nsis: {
		include: "build/installer.nsh",
		oneClick: false,
		perMachine: false,
		allowToChangeInstallationDirectory: true,
		runAfterFinish: false,
	},
	linux: {
		target: ["AppImage", "deb"],
		category: "Utility",
		executableName: "open-quake",
		maintainer: "Ramiro Rivera <ramarivera@users.noreply.github.com>",
	},
};
