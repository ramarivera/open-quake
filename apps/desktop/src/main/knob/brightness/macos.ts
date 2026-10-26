import { Effect } from "effect";
import { KnobDispatchFailed } from "../../../../../../packages/device/src/knob/knob-errors.js";
import type { BrightnessAdapter } from "./controller";
import { type BrightnessProcess, brightnessProcess } from "./native-process";
import { decodeBrightness } from "./native-response";

/** Fixed JXA. Arguments are data, never interpolated executable source. */
export const macBrightnessScript = `ObjC.import("Foundation");
ObjC.import("CoreGraphics");
function run(args) {
 if (!$.NSBundle.bundleWithPath("/System/Library/PrivateFrameworks/DisplayServices.framework").load) return JSON.stringify({supported:false});
 ObjC.bindFunction("DisplayServicesGetBrightness", ["int", ["unsigned int", "float *"]]);
 var display = Number($.CGMainDisplayID());
 var value = Ref();
 var result = Number($.DisplayServicesGetBrightness(display, value));
 if (result !== 0) return JSON.stringify({supported:false});
 if (args.length) {
  if (args.length !== 2 || String(display) !== args[0]) throw Error("Brightness target changed");
  var percent = Number(args[1]);
  if (!isFinite(percent) || percent < 0 || percent > 100) throw Error("Invalid brightness");
  ObjC.bindFunction("DisplayServicesSetBrightness", ["int", ["unsigned int", "float"]]);
  result = Number($.DisplayServicesSetBrightness(display, percent / 100));
  if (result !== 0) throw Error("Brightness write refused");
  result = Number($.DisplayServicesGetBrightness(display, value));
  if (result !== 0) throw Error("Brightness readback failed");
 }
 return JSON.stringify({supported:true,target:String(display),percent:Number(value[0])*100,quantum:0.01});
}`;
export function macBrightness(
	run: BrightnessProcess = brightnessProcess,
): BrightnessAdapter {
	const call = (args: readonly string[]) =>
		run("/usr/bin/osascript", [
			"-l",
			"JavaScript",
			"-e",
			macBrightnessScript,
			...args,
		]).pipe(Effect.flatMap(decodeBrightness));
	return {
		smooth: true,
		read: Effect.fn("DesktopBrightness.macRead")(() => call([]))(),
		write: Effect.fn("DesktopBrightness.macWrite")((before, percent) =>
			call([before.target, String(percent)]).pipe(
				Effect.flatMap((after) =>
					after.target === before.target
						? Effect.void
						: Effect.fail(
								KnobDispatchFailed.fromCause(
									new RangeError("Brightness target changed"),
								),
							),
				),
			),
		),
	};
}
