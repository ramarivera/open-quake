import {
	mkdir,
	mkdtemp,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { KnobDispatchFailed } from "../../../../../../packages/device/src/knob/knob-errors.js";
import { brightnessController } from "./controller";
import { nativeBrightness } from "./index";
import { linuxBrightness } from "./linux";
import { macBrightness, macBrightnessScript } from "./macos";
import type { BrightnessProcess } from "./native-process";
import { windowsBrightness } from "./windows";

const output = (percent = 50, target = "display") =>
	JSON.stringify({ supported: true, target, percent, quantum: 1 });
const failureTag = async <A, E extends { _tag: string }>(
	effect: Effect.Effect<A, E>,
) => {
	const result = await Effect.runPromise(Effect.either(effect));
	return Either.isLeft(result) ? result.left._tag : "success";
};
describe("native brightness protocols", () => {
	it("uses fixed JXA with separate data arguments and confirms write target", async () => {
		const calls: Array<{ file: string; args: readonly string[] }> = [];
		const run: BrightnessProcess = (file, args) =>
			Effect.sync(() => {
				calls.push({ file, args });
				return output(50, "2");
			});
		const adapter = macBrightness(run);
		const before = await Effect.runPromise(adapter.read);
		await Effect.runPromise(adapter.write(before, 55));
		expect(calls).toEqual([
			{
				file: "/usr/bin/osascript",
				args: ["-l", "JavaScript", "-e", macBrightnessScript],
			},
			{
				file: "/usr/bin/osascript",
				args: ["-l", "JavaScript", "-e", macBrightnessScript, "2", "55"],
			},
		]);
		expect(macBrightnessScript).toContain("DisplayServicesGetBrightness");
		expect(macBrightnessScript).toContain("String(display) !== args[0]");
	});
	it("encodes Windows data separately from PowerShell expressions and requires one active WMI target", async () => {
		const scripts: string[] = [];
		const target = "private'$(danger);display";
		const run: BrightnessProcess = (file, args) =>
			Effect.sync(() => {
				expect(file).toBe("powershell.exe");
				expect(args.slice(0, 4)).toEqual([
					"-NoLogo",
					"-NoProfile",
					"-NonInteractive",
					"-EncodedCommand",
				]);
				scripts.push(Buffer.from(args[4] ?? "", "base64").toString("utf16le"));
				return output(50, target);
			});
		const adapter = windowsBrightness(run);
		const before = await Effect.runPromise(adapter.read);
		await Effect.runPromise(adapter.write(before, 55));
		expect(scripts[0]).toContain("$items.Count -ne 1");
		expect(scripts[1]).toContain("WmiSetBrightness");
		expect(scripts[1]).not.toContain(target);
		expect(scripts[1]).not.toMatch(/SendInput|ExecutionPolicy|Start-Process/);
		const encoded = /FromBase64String\('([^']+)'\)/.exec(scripts[1] ?? "")?.[1];
		expect(
			JSON.parse(Buffer.from(encoded ?? "", "base64").toString("utf8")),
		).toEqual({ target, percent: 55 });
	});
	it.each([macBrightness, windowsBrightness])(
		"preserves native process errors and rejects unsupported/malformed readings",
		async (factory) => {
			const source = Object.assign(new Error("private-native-payload"), {
				code: "EACCES",
			});
			const error = KnobDispatchFailed.fromCause(source);
			const result = await Effect.runPromise(
				Effect.either(factory(() => Effect.fail(error)).read),
			);
			expect(Either.isLeft(result) && result.left.code).toBe(error.code);
			expect(
				Either.isLeft(result) && result.left.originalCause === source,
			).toBe(true);
			expect(error.originalCause).toBe(source);
			expect(JSON.stringify(error)).not.toContain("private-native-payload");
			for (const text of [
				"null",
				"invalid",
				output(101),
				JSON.stringify({
					supported: true,
					target: "x",
					percent: NaN,
					quantum: 1,
				}),
			])
				expect(await failureTag(factory(() => Effect.succeed(text)).read)).toBe(
					"KnobDispatchFailed",
				);
			expect(
				await failureTag(
					factory(() => Effect.succeed('{"supported":false}')).read,
				),
			).toBe("KnobCapabilityUnavailable");
			const adapter = factory(() => Effect.succeed(output(55, "replacement")));
			expect(
				await failureTag(
					adapter.write({ target: "old", percent: 50, quantum: 1 }, 55),
				),
			).toBe("KnobDispatchFailed");
		},
	);
	it.each(["darwin", "linux", "win32", "unknown"])(
		"disables host IO with mock devices on %s",
		async (platform) => {
			const adapter = nativeBrightness(platform, true);
			expect(await failureTag(adapter.read)).toBe("KnobCapabilityUnavailable");
			expect(
				await failureTag(
					adapter.write({ target: "never", percent: 50, quantum: 1 }, 55),
				),
			).toBe("KnobCapabilityUnavailable");
		},
	);
});

describe("Linux backlight adapter with real filesystem boundary", () => {
	const fixture = async () => {
		const root = await mkdtemp(join(tmpdir(), "backlight-"));
		const display = join(root, "test_backlight");
		await mkdir(display);
		await writeFile(join(display, "max_brightness"), "1000\n");
		await writeFile(join(display, "brightness"), "500\n");
		return {
			root,
			display,
			adapter: linuxBrightness(root),
			close: () => rm(root, { recursive: true, force: true }),
		};
	};
	it("scales actual numeric sysfs values through read, step, write and readback", async () => {
		const h = await fixture();
		try {
			const before = await Effect.runPromise(h.adapter.read);
			expect(before.percent).toBe(50);
			expect(before.quantum).toBe(0.1);
			await Effect.runPromise(brightnessController(h.adapter)(1));
			expect(
				(await readFile(join(h.display, "brightness"), "utf8")).trim(),
			).toBe("550");
			await Effect.runPromise(brightnessController(h.adapter)(-1));
			expect(
				(await readFile(join(h.display, "brightness"), "utf8")).trim(),
			).toBe("500");
		} finally {
			await h.close();
		}
	});
	it("rejects an absent or ambiguous target without guessing or writing", async () => {
		const h = await fixture();
		try {
			await mkdir(join(h.root, "second"));
			expect(await failureTag(h.adapter.read)).toBe(
				"KnobCapabilityUnavailable",
			);
			expect(
				await failureTag(linuxBrightness(join(h.root, "absent")).read),
			).toBe("KnobCapabilityUnavailable");
			expect(
				(await readFile(join(h.display, "brightness"), "utf8")).trim(),
			).toBe("500");
		} finally {
			await h.close();
		}
	});
	it.each(["range", "oversized", "nonnumeric", "replaced", "maximum"])(
		"refuses invalid or replaced state: %s",
		async (kind) => {
			const h = await fixture();
			try {
				const before = await Effect.runPromise(h.adapter.read);
				if (kind === "replaced") {
					await rename(join(h.display, "brightness"), join(h.display, "old"));
					await writeFile(join(h.display, "brightness"), "500\n");
				} else if (kind === "maximum")
					await writeFile(join(h.display, "max_brightness"), "2000\n");
				else
					await writeFile(
						join(h.display, "brightness"),
						kind === "range"
							? "1001\n"
							: kind === "oversized"
								? "5".repeat(129)
								: "unknown",
					);
				expect(await failureTag(h.adapter.write(before, 55))).toBe(
					"KnobDispatchFailed",
				);
			} finally {
				await h.close();
			}
		},
	);
});
