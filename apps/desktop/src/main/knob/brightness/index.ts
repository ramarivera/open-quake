import { type BrightnessAdapter, unavailableBrightness } from "./controller";
import { linuxBrightness } from "./linux";
import { macBrightness } from "./macos";
import { windowsBrightness } from "./windows";

/** A mock-device app cannot accidentally mutate the host monitor. */
export function nativeBrightness(
	platform: string = process.platform,
	mock = process.env.OPEN_QUAKE_MOCK_DEVICE === "1",
): BrightnessAdapter {
	if (mock) return unavailableBrightness;
	return platform === "darwin"
		? macBrightness()
		: platform === "win32"
			? windowsBrightness()
			: platform === "linux"
				? linuxBrightness()
				: unavailableBrightness;
}
