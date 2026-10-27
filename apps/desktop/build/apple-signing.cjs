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
	// Support Apple ID credentials on release runners and an existing local
	// notarytool profile. Do not silently fall through to a different account.
	if (["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"].some(present)) {
		fail("use Apple ID credentials or an existing APPLE_KEYCHAIN_PROFILE");
	}
	const appleId = present("APPLE_ID") || present("APPLE_APP_SPECIFIC_PASSWORD");
	const profile = present("APPLE_KEYCHAIN_PROFILE");
	if (
		appleId === profile ||
		(appleId &&
			(!present("APPLE_ID") || !present("APPLE_APP_SPECIFIC_PASSWORD")))
	) {
		fail(
			"provide APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD, or only APPLE_KEYCHAIN_PROFILE",
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
