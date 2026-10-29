import { Option, Schema } from "effect";
import { expect, it } from "vitest";
import { adaptHostShortcuts } from "./host-shortcuts.js";
import { keyTitle, localizedKey } from "./key-editing-invariants.js";
import { builtinProfiles } from "./profile-catalog.js";
import { Profile, ProfileJsonObject } from "./profile-contracts.js";

const quick = (host: "darwin" | "win32" | "linux") => {
	const p = builtinProfiles(host).find((p) => p.id === "1-2");
	if (!p) throw Error("Quick missing");
	return p;
};
it.each(["darwin", "win32", "linux"] as const)(
	"corrects default copy without changing custom titles on %s",
	(host) => {
		const p = quick(host);
		const key = p.pages[0].keys.find((k) => k.keyCode === "2,7");
		if (!key) throw Error("Clipboard missing");
		expect(localizedKey(key, "en").config.title.text).toBe("Clipboard");
		expect(
			localizedKey(
				{
					...key,
					config: {
						...key.config,
						userModifiedTitle: true,
						title: { ...key.config.title, text: "My Clip Board" },
					},
				},
				"en",
			).config.title.text,
		).toBe("My Clip Board");
	},
);
it.each(["win32", "linux"] as const)(
	"adapts all untouched Mac Quick bindings to %s and preserves custom bindings/styles",
	(host) => {
		const original = quick("darwin");
		const replacement = quick(host);
		const result = adaptHostShortcuts(original, host);
		for (const key of result.pages[0].keys) {
			const expected = replacement.pages[0].keys.find(
				(k) => k.keyCode === key.keyCode,
			);
			expect(key.config.actions).toEqual(expected?.config.actions);
			expect(key.config.size).toEqual(
				original.pages[0].keys.find((k) => k.keyCode === key.keyCode)?.config
					.size,
			);
		}
		const changed = {
			...original,
			pages: [
				{
					...original.pages[0],
					keys: original.pages[0].keys.map((k) =>
						k.keyCode === "1,7"
							? {
									...k,
									config: {
										...k.config,
										actions: [{ type: "text", value: "my-custom-command" }],
									},
								}
							: k,
					),
				},
			],
		} as typeof original;
		expect(
			adaptHostShortcuts(changed, host).pages[0].keys.find(
				(k) => k.keyCode === "1,7",
			)?.config.actions,
		).toEqual([{ type: "text", value: "my-custom-command" }]);
		expect(adaptHostShortcuts(result, host)).toBe(result);
	},
);
it.each(["darwin", "win32", "linux"] as const)(
	"keeps same-host relabeling serializable on %s",
	(host) => {
		const source = quick(host);
		const key = source.pages[0].keys.find((k) => k.keyCode === "2,7");
		if (!key) throw Error("Clipboard missing");
		const old = {
			...source,
			pages: [
				{
					...source.pages[0],
					keys: source.pages[0].keys.map((k) =>
						k === key
							? {
									...k,
									config: {
										...k.config,
										title: { ...k.config.title, text: "Clip Board" },
									},
								}
							: k,
					),
				},
			],
		} as typeof source;
		const updated = adaptHostShortcuts(old, host);
		expect(() => Schema.encodeSync(Profile)(updated)).not.toThrow();
		const encoded = Schema.encodeSync(Profile)(updated);
		expect(() =>
			Schema.decodeUnknownSync(ProfileJsonObject)(encoded),
		).not.toThrow();
	},
);
it.each(["darwin", "win32", "linux"] as const)(
	"adapts each built-in host to %s without retaining the previous host's labels",
	(target) => {
		for (const source of ["darwin", "win32", "linux"] as const) {
			const result = adaptHostShortcuts(quick(source), target),
				expected = quick(target);
			for (const key of result.pages[0].keys) {
				const wanted = expected.pages[0].keys.find(
					(k) => k.keyCode === key.keyCode,
				);
				if (!wanted) throw Error("Missing target key");
				expect(localizedKey(key, "en").config.title.text).toBe(
					localizedKey(wanted, "en").config.title.text,
				);
				expect(key.config.actions).toEqual(wanted.config.actions);
			}
		}
	},
);
it("follows original catalog identity after moving a customized tile", () => {
	const source = quick("darwin"),
		original = source.pages[0].keys.find((k) => k.keyCode === "2,8");
	if (!original) throw Error("Exposé missing");
	const moved = {
		...original,
		keyCode: "3,4",
		config: {
			...original.config,
			icon: "my-artwork.png",
			size: [2, 1],
			userModifiedTitle: true,
			title: {
				...original.config.title,
				text: "My overview",
				userModifiedStyle: true,
				color: "#f08080",
			},
		},
	} as typeof original;
	const result = adaptHostShortcuts(
		{ ...source, pages: [{ ...source.pages[0], keys: [moved] }] },
		"win32",
	).pages[0].keys[0];
	if (!result) throw Error("Moved tile missing");
	expect(result.keyCode).toBe("3,4");
	expect(result.config.icon).toBe("my-artwork.png");
	expect(result.config.size).toEqual([2, 1]);
	expect(result.config.title).toEqual(moved.config.title);
	expect(result.config.actions).toEqual(
		quick("win32").pages[0].keys.find((k) => k.keyCode === "2,8")?.config
			.actions,
	);
});

it.each(["darwin", "win32", "linux"] as const)(
	"keeps default microphone alternate casing consistent on %s",
	(host) => {
		const key = quick(host).pages[0].keys.find((k) => k.config.type === "mic");
		if (!key) throw Error("Mic missing");
		expect(keyTitle(key, "en", true)).toBe("Device mic");
		const title = { ...key.config.title, text: "Device Mic" };
		const legacy = {
			...key,
			config: {
				...key.config,
				alterTitle: Option.some(title),
				userModifiedAlterTitle: false,
			},
		};
		expect(keyTitle(legacy, "en", true)).toBe("Device mic");
		expect(
			keyTitle(
				{
					...legacy,
					config: { ...legacy.config, userModifiedAlterTitle: true },
				},
				"en",
				true,
			),
		).toBe("Device Mic");
	},
);
