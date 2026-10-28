/** Serialized into the real renderer. Observes DOM only; never dispatches UI events. */
export function installObserver(): void {
	const state = {
		mutations: 0,
		errors: [] as string[],
		navigation: 0,
		dialogs: 0,
		inputs: 0,
		keys: [] as { key: string; code: string; target: string }[],
	};
	Object.assign(window, { managementExercise: state });
	window.confirm = () => {
		state.dialogs++;
		return false;
	};
	window.alert = () => {
		state.dialogs++;
	};
	window.prompt = () => {
		state.dialogs++;
		return null;
	};
	document.addEventListener("keydown", (event) => {
		if (event.isTrusted) state.inputs++;
		state.keys.push({
			key: event.key,
			code: event.code,
			target: event.target instanceof Element ? event.target.id : "",
		});
		if (state.keys.length > 20) state.keys.shift();
	});
	document.addEventListener("pointerdown", (event) => {
		if (event.isTrusted) state.inputs++;
	});
	new MutationObserver((records) => {
		state.mutations += records.filter(
			(record) =>
				!(
					record.target instanceof Element &&
					record.target.closest(".strip-panel, .mc-runtime, [role=timer]")
				) &&
				!(
					record.type === "attributes" &&
					["style", "data-exercise-id"].includes(record.attributeName ?? "")
				),
		).length;
	}).observe(document.documentElement, {
		subtree: true,
		childList: true,
		attributes: true,
		characterData: true,
	});
	window.addEventListener("error", (event) => state.errors.push(event.message));
	window.addEventListener("unhandledrejection", (event) =>
		state.errors.push(String(event.reason)),
	);
	window.addEventListener("hashchange", () => state.navigation++);
	window.addEventListener("popstate", () => state.navigation++);
}

export interface Control {
	id: string;
	/** aria-pressed before activation, so toggle filters can be restored. */
	pressed: string | null;
	/** Rendered inside an open modal dialog. */
	inDialog: boolean;
	identity: string;
	position: string;
	selector: string;
	generated: boolean;
	label: string;
	context: string;
	tag: string;
	type: string;
	disabled: boolean;
	value: string;
	options: string[];
	selected: boolean;
	restoreRadio: string;
}

/** Include collapsed details after their summary is opened by the crawler. */
export function enumerateControls(): Control[] {
	const dialogs = document.querySelectorAll<HTMLElement>(
		"dialog[open], [role=dialog][aria-modal=true], [role=alertdialog][aria-modal=true]",
	);
	const scope = dialogs[dialogs.length - 1] ?? document.querySelector("main");
	const nodes =
		scope?.querySelectorAll<HTMLElement>(
			"button,a,select,input,textarea,summary,[role=menuitem],[role=checkbox]",
		) ?? [];

	return Array.from(nodes)
		.filter((node) => {
			const closed = node.closest("details:not([open])");
			return (
				node.getClientRects().length > 0 &&
				!node.closest("[inert]") &&
				(!closed || !!closed.querySelector(":scope > summary")?.contains(node))
			);
		})
		.sort((left, right) => {
			if (!dialogs.length) return 0;
			const closes = (node: HTMLElement) =>
				/^(close|cancel|done)$/i.test(
					(node.getAttribute("aria-label") || node.textContent || "").trim(),
				);
			return Number(closes(left)) - Number(closes(right));
		})
		.map((node, index) => {
			const label =
				node.getAttribute("aria-label") ||
				node.getAttribute("title") ||
				(node.id
					? document.querySelector(`label[for="${CSS.escape(node.id)}"]`)
							?.textContent
					: "") ||
				node.closest("label")?.textContent?.trim() ||
				node
					.closest(".row")
					?.querySelector(".row-label")
					?.textContent?.trim() ||
				node.textContent?.trim() ||
				node.getAttribute("placeholder") ||
				node.id ||
				`${node.tagName.toLowerCase()}-${index}`;
			const path: string[] = [];
			let cursor: Element | null = node;
			while (cursor && cursor.tagName !== "MAIN") {
				const parent: Element | null = cursor.parentElement;
				path.unshift(
					`${cursor.tagName.toLowerCase()}:nth-child(${parent ? Array.from(parent.children).indexOf(cursor) + 1 : 1})`,
				);
				cursor = parent;
			}
			const row = node.closest<HTMLElement>(".profile-row");
			const fixture = window as Window & {
				managementExerciseInitialProfiles?: string[];
				managementExerciseGeneratedProfiles?: Record<string, number>;
			};
			const profileId = row?.dataset.profileRowId;
			const generated =
				!!profileId &&
				!fixture.managementExerciseInitialProfiles?.includes(profileId);
			fixture.managementExerciseGeneratedProfiles ??= {};
			const aliases = fixture.managementExerciseGeneratedProfiles;
			if (generated && profileId && aliases[profileId] === undefined)
				aliases[profileId] = Object.keys(aliases).length;
			const rowIdentity = generated
				? `generated-${aliases[profileId ?? ""]}`
				: profileId;
			const rowPath: string[] = [];
			let child: Element | null = node;
			while (child && child !== row) {
				const parent: Element | null = child.parentElement;
				rowPath.unshift(
					`${child.tagName.toLowerCase()}:nth-child(${parent ? Array.from(parent.children).indexOf(child) + 1 : 1})`,
				);
				child = parent;
			}
			const id = node.dataset.exerciseId ?? `control-${crypto.randomUUID()}`;
			node.dataset.exerciseId = id;
			return {
				id,
				identity:
					node.id ||
					(rowIdentity
						? `profile:${rowIdentity}:${rowPath.join("/")}`
						: `${path.join("/")}:${node.matches("input,textarea,select") ? node.tagName.toLowerCase() : label.trim().replace(/\s+/g, " ").slice(0, 180)}`),
				position: node.id || `${path.join("/")}:${node.tagName}`,
				// The exercise id also resolves controls inside dialogs outside <main>.
				selector: node.id
					? `[id=${JSON.stringify(node.id)}]`
					: profileId
						? `.profile-row[data-profile-row-id=${JSON.stringify(profileId)}] > ${rowPath.join(" > ")}`
						: `[data-exercise-id=${JSON.stringify(id)}]`,
				pressed: node.getAttribute("aria-pressed"),
				inDialog: dialogs.length > 0,
				generated,
				label: label.trim().replace(/\s+/g, " ").slice(0, 180),
				context:
					(
						node.closest(".row")?.querySelector(".row-label")?.textContent ??
						node.closest("label")?.textContent
					)
						?.trim()
						.slice(0, 240) ?? "",
				tag: node.tagName.toLowerCase(),
				type: node.getAttribute("type") ?? "",
				disabled: node.matches(":disabled, [aria-disabled=true]"),
				value:
					node instanceof HTMLInputElement ||
					node instanceof HTMLSelectElement ||
					node instanceof HTMLTextAreaElement
						? node.value
						: "",
				options:
					node instanceof HTMLSelectElement
						? Array.from(node.options)
								.filter((option) => !option.disabled)
								.map((option) => option.value)
						: [],
				restoreRadio:
					node instanceof HTMLInputElement && node.type === "radio" && node.name
						? (() => {
								const checked = document.querySelector<HTMLInputElement>(
									`input[type=radio][name=${JSON.stringify(node.name)}]:checked`,
								);
								return checked
									? `input[type=radio][name=${JSON.stringify(checked.name)}][value=${JSON.stringify(checked.value)}]`
									: "";
							})()
						: "",
				selected:
					(node instanceof HTMLInputElement &&
						node.type === "radio" &&
						node.checked) ||
					(node.matches("[aria-pressed=true]") &&
						!!node.closest(".mc-tabs,[role=tablist]")) ||
					(node.matches(".emoji-pack > button:first-child") &&
						node.closest(".emoji-pack")?.getAttribute("data-current") ===
							"true") ||
					node.matches(
						"[role=tab][aria-selected=true], [role=radio][aria-checked=true], [aria-current=page]",
					) ||
					(node instanceof HTMLDetailsElement && node.open),
			};
		});
}

export function observation() {
	const state = (
		window as Window & {
			managementExercise?: {
				mutations: number;
				navigation: number;
				dialogs: number;
				inputs: number;
				errors: string[];
			};
		}
	).managementExercise;
	const active = document.activeElement;
	return {
		mutations: state?.mutations ?? 0,
		navigation: state?.navigation ?? 0,
		dialogs: state?.dialogs ?? 0,
		inputs: state?.inputs ?? 0,
		errors: state?.errors ?? [],
		editable: active?.matches("input,textarea,[contenteditable=true]")
			? (active.getAttribute("data-exercise-id") ?? active.id)
			: "",
		url: location.href,
		values: Array.from(
			document.querySelectorAll<
				HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
			>("main input,main select,main textarea"),
		).map((node) => [
			node.id,
			node.value,
			"checked" in node ? node.checked : null,
		]),
	};
}
