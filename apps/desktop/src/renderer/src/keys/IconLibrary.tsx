import { useCallback, useEffect, useMemo, useState } from "react";
import { keyText } from "../../../../../../packages/device/src/profiles/key-editing-invariants.js";
import type { LibraryPack } from "../../../shared/key-library";
import { Group, Row } from "../ui/Form";

type MdiIcon = {
	readonly name: string;
	readonly tags: readonly string[];
	readonly path: string;
};
const mdiData = (path: string): string =>
	`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="white" d="${path}"/></svg>`)}`;
export function IconLibrary({
	onSelect,
	onClose,
}: {
	onSelect: (data: string) => void;
	onClose: () => void;
}): React.JSX.Element {
	const [packs, setPacks] = useState<readonly LibraryPack[]>([]),
		[mdi, setMdi] = useState<readonly MdiIcon[]>(),
		[query, setQuery] = useState(""),
		[search, setSearch] = useState(""),
		[group, setGroup] = useState("mdi"),
		[zoom, setZoom] = useState(72),
		[limit, setLimit] = useState(120),
		[status, setStatus] = useState(keyText("iconLib.loadingGroups"));
	const load = useCallback(async (): Promise<void> => {
		const reply = await window.quakeKeyLibrary.request({ type: "icons" });
		if (reply._tag === "success") {
			setPacks(reply.packs ?? []);
			setStatus("");
		} else setStatus(reply.reason);
	}, []);
	useEffect(() => {
		let live = true;
		void load();
		void import("virtual:mdi-icons").then((module) => {
			if (live) setMdi(module.default);
		});
		return () => {
			live = false;
		};
	}, [load]);
	useEffect(() => {
		const timer = setTimeout(() => {
			setSearch(query.trim().toLowerCase());
			setLimit(120);
		}, 500);
		return () => clearTimeout(timer);
	}, [query]);
	const groups = useMemo(
		() =>
			[
				{
					id: "mdi",
					name: keyText("iconLib.groupMaterial"),
					icons: (mdi ?? []).map((i) => ({
						id: i.name,
						name: i.name,
						tags: i.tags,
						data: () => mdiData(i.path),
					})),
				},
				...packs.map((p) => ({
					...p,
					icons: p.icons.map((i) => ({ ...i, data: () => i.data })),
				})),
			]
				.map((p) => ({
					...p,
					icons: p.icons.filter((i) =>
						`${i.name} ${i.tags.join(" ")}`.toLowerCase().includes(search),
					),
				}))
				.filter((p) => p.icons.length || !search),
		[mdi, packs, search],
	);
	const selected = groups.find((p) => p.id === group) ?? groups[0];
	const remove = async (id: string, icon = false): Promise<void> => {
		if (
			!confirm(
				icon
					? keyText("iconLib.deleteCustomIconConfirm").replace(
							"{{iconName}}",
							id,
						)
					: keyText("iconLib.deleteIconPackConfirm").replace(
							"{{iconPackName}}",
							packs.find((p) => p.id === id)?.name ?? id,
						),
			)
		)
			return;
		const reply = await window.quakeKeyLibrary.request({
			type: icon ? "remove-icon" : "remove-pack",
			id,
		});
		if (reply._tag === "success") setPacks(reply.packs ?? []);
		else setStatus(reply.reason);
	};
	const upload = async (type: "import-pack" | "import-icon"): Promise<void> => {
		setStatus(keyText("iconLib.loadingIcons"));
		const reply = await window.quakeKeyLibrary.request({ type });
		if (reply._tag === "success") {
			setPacks(reply.packs ?? []);
			setStatus("");
		} else setStatus(reply.reason);
	};
	return (
		<section className="key-icon-library" aria-label={keyText("iconLib.title")}>
			<Group title={keyText("iconLib.title")}>
				<Row label={keyText("iconLib.searchHint")} htmlFor="icon-search">
					<input
						id="icon-search"
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close Icon Library"
					>
						×
					</button>
				</Row>
				<div className="icon-library-body">
					<aside aria-label="Icon groups">
						{groups.map((p) => (
							<div key={p.id}>
								<button
									type="button"
									aria-pressed={selected?.id === p.id}
									onClick={() => {
										setGroup(p.id);
										setLimit(120);
									}}
								>
									{p.name}{" "}
									<small>{p.id === "mdi" && !mdi ? "…" : p.icons.length}</small>
								</button>
								{p.id !== "mdi" && p.id !== "local" && (
									<button
										type="button"
										aria-label={`Uninstall ${p.name}`}
										onClick={() => void remove(p.id)}
									>
										×
									</button>
								)}
							</div>
						))}
					</aside>
					<ul
						className="icon-library-grid"
						onScroll={(e) => {
							const node = e.currentTarget;
							if (node.scrollHeight - node.scrollTop - node.clientHeight < 100)
								setLimit((n) => n + 120);
						}}
						style={{
							gridTemplateColumns: `repeat(auto-fill, minmax(${zoom}px,1fr))`,
						}}
					>
						{!mdi && group === "mdi" ? (
							<li role="status">{keyText("iconLib.loadingMaterial")}</li>
						) : selected?.icons.length ? (
							selected.icons.slice(0, limit).map((icon) => (
								<li key={icon.id} className="icon-library-cell">
									<button
										type="button"
										title={icon.name}
										aria-label={`Select ${icon.name}`}
										style={{ height: zoom }}
										onClick={() => onSelect(icon.data())}
									>
										<img
											loading="lazy"
											src={icon.data()}
											alt=""
											style={{ width: zoom * 0.6, height: zoom * 0.6 }}
										/>
									</button>
									{selected.id === "local" && (
										<button
											type="button"
											aria-label={`Delete ${icon.name}`}
											onClick={() => void remove(icon.id, true)}
										>
											×
										</button>
									)}
								</li>
							))
						) : (
							<li>{keyText("iconLib.searchHint")}</li>
						)}
					</ul>
				</div>
				<Row
					label={keyText("iconLib.importIcon")}
					hint={keyText("iconLib.iconPackSupportType")}
				>
					<button type="button" onClick={() => void upload("import-pack")}>
						{keyText("iconLib.importIcon")}
					</button>
					<button type="button" onClick={() => void upload("import-icon")}>
						Select Picture
					</button>
				</Row>
				<Row label={`${zoom}px`}>
					<button
						type="button"
						aria-label="Zoom out"
						disabled={zoom <= 40}
						onClick={() => setZoom((z) => Math.max(40, z - 8))}
					>
						−
					</button>
					<input
						aria-label="Icon size"
						type="range"
						min={40}
						max={120}
						step={8}
						value={zoom}
						onChange={(e) => setZoom(Number(e.target.value))}
					/>
					<button
						type="button"
						aria-label="Zoom in"
						disabled={zoom >= 120}
						onClick={() => setZoom((z) => Math.min(120, z + 8))}
					>
						+
					</button>
				</Row>
			</Group>
			{status && <p role="status">{status}</p>}
		</section>
	);
}
