// Keep this policy shared by the builder and the distributed-package smoke.
const APPLE_TEAM = "TRGDCMBX3J";
const APPLE_IDENTITY = `Ramiro Rivera (${APPLE_TEAM})`;

function appleSigningRequired(env = process.env, platform = process.platform) {
	if (platform !== "darwin") return false;
	const tagRelease =
		env.GITHUB_EVENT_NAME === "push" &&
		env.GITHUB_REF?.startsWith("refs/tags/v");
	return Boolean(tagRelease || env.OPEN_QUAKE_APPLE_SIGNING === "1");
}

function appleSigningOptions(env = process.env, platform = process.platform) {
	if (!appleSigningRequired(env, platform)) {
		return { identity: "-", hardenedRuntime: false, notarize: false };
	}
	const fail = (message) => {
		throw new Error(`Apple release signing: ${message}`);
	};
	const present = (name) => Boolean(env[name]?.trim());
	if (env.GITHUB_EVENT_NAME?.startsWith("pull_request")) {
		fail("signing credentials must never be used in pull-request builds");
	}
	if (env.APPLE_TEAM_ID !== APPLE_TEAM) {
		fail(`APPLE_TEAM_ID must be ${APPLE_TEAM}`);
	}
	// Match electron-builder 26.18.0's notarization credential precedence.
	// Support the existing Apple API identity as well as Apple ID credentials
	// and a local notarytool profile. Reject mixed modes before builder precedence.
	const apiKeys = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"];
	const api = apiKeys.some(present);
	const appleId = present("APPLE_ID") || present("APPLE_APP_SPECIFIC_PASSWORD");
	const profile = present("APPLE_KEYCHAIN_PROFILE");
	if (
		Number(api) + Number(appleId) + Number(profile) !== 1 ||
		(api && !apiKeys.every(present)) ||
		(appleId &&
			(!present("APPLE_ID") || !present("APPLE_APP_SPECIFIC_PASSWORD")))
	) {
		fail(
			"provide exactly one complete API key, Apple ID pair, or keychain profile",
		);
	}
	if (env.GITHUB_ACTIONS === "true") {
		for (const key of ["CSC_LINK", "CSC_KEY_PASSWORD", "APP_BUILDER_TMP_DIR"]) {
			if (!present(key)) fail(`${key} is required on the release runner`);
		}
	}
	return {
		// Builder selects the Developer ID Application certificate type itself;
		// its identity qualifier must omit the "Developer ID Application:" prefix.
		identity: APPLE_IDENTITY,
		type: "distribution",
		hardenedRuntime: true,
		notarize: true,
		strictVerify: true,
		entitlements: "build/entitlements.mac.plist",
		entitlementsInherit: "build/entitlements.mac.plist",
	};
}

module.exports = {
	APPLE_TEAM,
	APPLE_IDENTITY,
	appleSigningRequired,
	appleSigningOptions,
};
