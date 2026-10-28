// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { enumerateControls } from "./exerciser-dom";

afterEach(() => {
	document.body.replaceChildren();
	vi.restoreAllMocks();
});
it("keeps profile identities across rename, reordering and generated record recreation", () => {
	vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue(
		Object.assign([new DOMRect()], {
			item: (index: number) => (index === 0 ? new DOMRect() : null),
		}),
	);
	const fixture = window as Window & {
		managementExerciseInitialProfiles?: string[];
		managementExerciseGeneratedProfiles?: Record<string, number>;
	};
	fixture.managementExerciseInitialProfiles = ["original"];
	fixture.managementExerciseGeneratedProfiles = {};
	document.body.innerHTML =
		'<main><ul><li class="profile-row" data-profile-row-id="original"><button>Custom</button><input aria-label="Rename Custom"></li><li class="profile-row" data-profile-row-id="random"><button>Copy</button></li></ul></main>';
	const before = enumerateControls();
	expect(before.map((c) => c.generated)).toEqual([false, false, true]);
	const row = document.querySelector(
		'.profile-row[data-profile-row-id="original"]',
	);
	if (!row) throw new Error("Missing row");
	row.innerHTML = '<button>Renamed</button><input aria-label="Rename Renamed">';
	row.parentElement?.append(row);
	const after = enumerateControls();
	expect(after.map((c) => c.identity).sort()).toEqual(
		before.map((c) => c.identity).sort(),
	);
	for (const control of before)
		expect(document.querySelector(control.selector)).not.toBeNull();
});
it("marks the current emoji package as selected, leaving other packages actionable", () => {
	vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue(
		Object.assign([new DOMRect()], {
			item: (index: number) => (index === 0 ? new DOMRect() : null),
		}),
	);
	document.body.innerHTML =
		'<main><div class="emoji-pack" data-current="true"><button>Pack 1</button><button>Edit</button></div><div class="emoji-pack" data-current="false"><button>Pack 2</button></div></main>';
	expect(enumerateControls().map((c) => c.selected)).toEqual([
		true,
		false,
		false,
	]);
});

it("doesn't rediscover a text field when its live counter changes", () => {
	vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue(
		Object.assign([new DOMRect()], {
			item: (index: number) => (index === 0 ? new DOMRect() : null),
		}),
	);
	document.body.innerHTML =
		"<main><label>Emoji name<input><small>0/30</small></label></main>";
	const before = enumerateControls()[0];
	const counter = document.querySelector("small");
	if (!counter) throw new Error("Missing counter");
	counter.textContent = "7/30";
	expect(enumerateControls()[0]?.identity).toBe(before?.identity);
});

it("ignores descendants of collapsed details even when Chromium retains their rectangles", () => {
	vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue(
		Object.assign([new DOMRect()], {
			item: (index: number) => (index === 0 ? new DOMRect() : null),
		}),
	);
	document.body.innerHTML =
		"<main><details><summary>Library</summary><button>Emoji</button><details open><summary>Nested</summary><input></details></details></main>";
	expect(enumerateControls().map((c) => c.label)).toEqual(["Library"]);
	document.querySelector("details")?.setAttribute("open", "");
	expect(enumerateControls().map((c) => c.tag)).toEqual([
		"summary",
		"button",
		"summary",
		"input",
	]);
});
