import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { keyText } from "../../../../../../packages/device/src/profiles/key-editing-invariants.js";
import type { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import type { LibraryPack } from "../../../shared/key-library";
import { useArtworkVisibility, validatedArtwork } from "../strip/useTileArt";

type MdiIcon = {
	readonly name: string;
	readonly tags: readonly string[];
	readonly path: string;
	readonly extraData?: readonly string[];
};
const mdiData = (path: string): string =>
	`data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="white" d="${path}"/></svg>`)}`;

/** Decode an inert URL into portable pixels; imported markup is never inserted in DOM. */
export async function rasterizeIcon(data: string): Promise<string> {
	if (!validatedArtwork(data)) throw new Error("Invalid icon image.");
	const image = new Image();
	image.src = data;
	await image.decode();
	if (
		!image.naturalWidth ||
		image.naturalWidth * image.naturalHeight > 16000000
	)
		throw new Error("Invalid icon image.");
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = 170;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Could not prepare icon.");
	const scale = Math.min(170 / image.naturalWidth, 170 / image.naturalHeight);
	const width = image.naturalWidth * scale,
		height = image.naturalHeight * scale;
	context.drawImage(
		image,
		(170 - width) / 2,
		(170 - height) / 2,
		width,
		height,
	);
	return canvas.toDataURL("image/png");
}

function IconImage({
	data,
	size,
}: {
	data: () => string;
	size: number;
}): React.JSX.Element {
	const { ref, visible } = useArtworkVisibility<HTMLImageElement>();
	return (
		<img
			ref={ref}
			src={visible ? validatedArtwork(data()) || undefined : undefined}
			alt=""
			style={{ width: size, height: size }}
		/>
	);
}

export function IconLibrary({
	onSelect,
	onClose,
	locale = "en",
}: {
	onSelect: (data: string, source: string) => void | Promise<void>;
	onClose: () => void;
	locale?: ProfileLocale;
}): React.JSX.Element {
	const [packs, setPacks] = useState<readonly LibraryPack[]>([]),
		[applications, setApplications] = useState<readonly LibraryPack[]>([]),
		[mdi, setMdi] = useState<readonly MdiIcon[]>(),
		[phosphor, setPhosphor] =
			useState<typeof import("virtual:phosphor-icons")["default"]>(),
		[query, setQuery] = useState(""),
		[search, setSearch] = useState(""),
		[group, setGroup] = useState("phosphor"),
		[zoom, setZoom] = useState(72),
		[width, setWidth] = useState(window.innerWidth),
		[limit, setLimit] = useState(0),
		[loading, setLoading] = useState(true),
		[progress, setProgress] = useState(8),
		[stage, setStage] = useState("iconLib.loadingGroups"),
		[status, setStatus] = useState(""),
		[notice, setNotice] = useState(""),
		[selectedIcon, setSelectedIcon] = useState(""),
		[retry, setRetry] = useState(0);
	const grid = useRef<HTMLUListElement>(null);
	const mounted = useRef(true);
	const loadGeneration = useRef(0);
	const batch = 10 * Math.max(1, Math.floor(width / (zoom + 12)));
	const t = (key: string): string => keyText(key, locale);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		const resize = (): void => setWidth(window.innerWidth);
		window.addEventListener("resize", resize);
		return () => window.removeEventListener("resize", resize);
	}, []);
	useEffect(() => {
		let live = true;
		const ticket = retry;
		loadGeneration.current = ticket;
		const isLive = (): boolean => live && loadGeneration.current === ticket;
		setLoading(true);
		setProgress(8);
		setStage("iconLib.loadingGroups");
		setStatus("");
		setNotice("");
		void (async () => {
			try {
				const library = await window.quakeKeyLibrary.request({ type: "icons" });
				if (!isLive()) return;
				if (library._tag === "rejected") throw new Error(library.reason);
				setPacks(library.packs ?? []);
				setProgress(28);
				setStage("iconLib.loadingCustom");
				const apps = await window.quakeKeyLibrary.request({
					type: "application-icons",
				});
				if (!isLive()) return;
				if (apps._tag === "success") setApplications(apps.packs ?? []);
				else setStatus(apps.reason);
				setProgress(48);
				setStage("iconLib.loadingMaterial");
				const module = await import("virtual:mdi-icons");
				if (!isLive()) return;
				setMdi(module.default);
				setProgress(80);
				setStage("iconLib.loadingIcons");
				const phosphorModule = await import("virtual:phosphor-icons");
				if (!isLive()) return;
				setPhosphor(phosphorModule.default);
				setProgress(100);
			} catch (cause) {
				if (isLive())
					setStatus(
						cause instanceof Error ? cause.message : "Could not load icons.",
					);
			} finally {
				if (isLive()) setLoading(false);
			}
		})();
		return () => {
			live = false;
		};
	}, [retry]);
	useEffect(() => {
		const timer = setTimeout(() => {
			setSearch(query.trim().toLowerCase());
			setLimit(batch);
			if (grid.current) grid.current.scrollTop = 0;
		}, 500);
		return () => clearTimeout(timer);
	}, [query, batch]);
	useEffect(() => {
		setLimit(batch);
		if (grid.current) grid.current.scrollTop = 0;
	}, [batch]);
	const groups = useMemo(
		() =>
			[
				{
					id: "phosphor",
					name: "Phosphor",
					icons: (phosphor ?? []).map((icon) => ({
						id: icon.name,
						name: icon.name,
						tags: icon.tags,
						extraData: undefined,
						data: () => `data:image/svg+xml,${encodeURIComponent(icon.svg)}`,
					})),
				},
				{
					id: "mdi",
					name: keyText("iconLib.groupMaterial", locale),
					icons: (mdi ?? []).map((icon) => ({
						id: icon.name,
						name: icon.name,
						tags: icon.tags,
						extraData: icon.extraData,
						data: () => mdiData(icon.path),
					})),
				},
				...applications.map((pack) => ({
					...pack,
					icons: pack.icons.map((icon) => ({ ...icon, data: () => icon.data })),
				})),
				...packs.map((pack) => ({
					...pack,
					icons: pack.icons.map((icon) => ({ ...icon, data: () => icon.data })),
				})),
			]
				.map((pack) => ({
					...pack,
					icons: pack.icons.filter((icon) =>
						`${icon.name} ${icon.tags.join(" ")} ${icon.extraData?.join(" ") ?? ""}`
							.toLowerCase()
							.includes(search),
					),
				}))
				.filter(
					(pack) =>
						((pack.id !== "local" && pack.id !== "applications") ||
							pack.icons.length > 0) &&
						(pack.icons.length || !search),
				),
		[mdi, phosphor, packs, applications, search, locale],
	);
	const selected = groups.find((pack) => pack.id === group) ?? groups[0];
	const total = selected?.icons.length ?? 0;
	useLayoutEffect(() => {
		const node = grid.current;
		if (!node) return;
		const fill = (): void => {
			if (node.clientHeight > 0 && node.scrollHeight <= node.clientHeight)
				setLimit((count) => Math.min(total, count + batch));
		};
		fill();
		const observer = new ResizeObserver(fill);
		observer.observe(node);
		return () => observer.disconnect();
	});
	const remove = async (id: string, icon = false): Promise<void> => {
		if (loading) return;
		const name = icon
			? (packs
					.find((pack) => pack.id === "local")
					?.icons.find((item) => item.id === id)?.name ?? id)
			: (packs.find((pack) => pack.id === id)?.name ?? id);
		if (
			!confirm(
				icon
					? t("iconLib.deleteCustomIconConfirm").replace("{{iconName}}", name)
					: t("iconLib.deleteIconPackConfirm").replace(
							"{{iconPackName}}",
							name,
						),
			)
		)
			return;
		setLoading(true);
		setProgress(8);
		setStage("iconLib.loadingGroups");
		setStatus("");
		setNotice("");
		try {
			const reply = await window.quakeKeyLibrary.request({
				type: icon ? "remove-icon" : "remove-pack",
				id,
			});
			if (!mounted.current) return;
			if (reply._tag === "success") {
				setPacks(reply.packs ?? []);
				setNotice(
					t(
						icon
							? "iconLib.deleteCustomIconSuccess"
							: "iconLib.deleteIconPackSuccess",
					).replace(icon ? "{{iconName}}" : "{{iconPackName}}", name),
				);
			} else setStatus(reply.reason);
		} catch {
			if (mounted.current)
				setStatus(
					t(
						icon
							? "iconLib.deleteCustomIconFailed"
							: "iconLib.deleteIconPackFailed",
					).replace(icon ? "{{iconName}}" : "{{iconPackName}}", name),
				);
		} finally {
			if (mounted.current) setLoading(false);
		}
	};
	const upload = async (type: "import-pack" | "import-icon"): Promise<void> => {
		setLoading(true);
		setProgress(8);
		setStage("iconLib.loadingGroups");
		setStatus("");
		setNotice("");
		try {
			const reply = await window.quakeKeyLibrary.request({ type });
			if (!mounted.current) return;
			if (reply._tag === "success") {
				setPacks(reply.packs ?? []);
				setProgress(100);
				setNotice(
					reply.notice === "duplicate-icon"
						? t("iconLib.duplicateIconDetected")
						: "",
				);
			} else setStatus(reply.reason);
		} catch {
			if (mounted.current) setStatus(t("iconLib.addIconFailed"));
		} finally {
			if (mounted.current) setLoading(false);
		}
	};
	const choosing = useRef(false);
	const choose = async (id: string, data: string): Promise<void> => {
		if (loading || choosing.current) return;
		choosing.current = true;
		setSelectedIcon(id);
		setLoading(true);
		setProgress(88);
		setStage("iconLib.loadingIcons");
		setStatus("");
		try {
			const pixels = await rasterizeIcon(data);
			if (mounted.current) await onSelect(pixels, data);
		} catch (cause) {
			if (mounted.current)
				setStatus(
					cause instanceof Error ? cause.message : "Could not prepare icon.",
				);
		} finally {
			choosing.current = false;
			if (mounted.current) {
				setProgress(100);
				setLoading(false);
			}
		}
	};
	return (
		<section className="key-icon-library" aria-label={t("iconLib.title")}>
			<header className="icon-library-toolbar">
				<label className="visually-hidden" htmlFor="icon-search">
					{t("iconLib.searchHint")}
				</label>
				<input
					id="icon-search"
					type="search"
					placeholder={t("iconLib.searchHint")}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				<span className="icon-library-count">
					{selected?.icons.length ?? 0}
				</span>
				<button type="button" onClick={onClose} aria-label={t("close")}>
					×
				</button>
			</header>
			<div className="icon-library-body-wrap">
				<div className="icon-library-body" aria-busy={loading}>
					<aside aria-label="Icon groups">
						{groups.map((pack) => (
							<div key={pack.id} className="icon-library-group">
								<button
									type="button"
									aria-label={pack.name}
									aria-pressed={selected?.id === pack.id}
									onClick={() => {
										setGroup(pack.id);
										setLimit(batch);
										if (grid.current) grid.current.scrollTop = 0;
									}}
								>
									<span>{pack.name}</span>
									<small>
										{(pack.id === "mdi" && !mdi) ||
										(pack.id === "phosphor" && !phosphor)
											? "…"
											: pack.icons.length}
									</small>
								</button>
								{!["phosphor", "mdi", "local", "applications"].includes(
									pack.id,
								) && (
									<button
										type="button"
										aria-label={`Uninstall ${pack.name}`}
										disabled={loading}
										onClick={() => void remove(pack.id)}
									>
										×
									</button>
								)}
							</div>
						))}
					</aside>
					<ul
						ref={grid}
						className="icon-library-grid"
						data-batch={batch}
						onScroll={(event) => {
							const node = event.currentTarget;
							if (node.scrollHeight - node.scrollTop - node.clientHeight < 100)
								setLimit((count) =>
									Math.min(selected?.icons.length ?? 0, count + batch),
								);
						}}
						style={{
							gridTemplateColumns: `repeat(auto-fill, minmax(${zoom}px,1fr))`,
						}}
					>
						{selected?.icons.length ? (
							selected.icons.slice(0, limit).map((icon) => (
								<li key={icon.id} className="icon-library-cell">
									<button
										type="button"
										title={icon.name}
										aria-label={`Select ${icon.name}`}
										style={{ height: zoom }}
										aria-pressed={selectedIcon === `${selected.id}:${icon.id}`}
										disabled={loading}
										onClick={() =>
											void choose(`${selected.id}:${icon.id}`, icon.data())
										}
									>
										<IconImage data={icon.data} size={zoom * 0.6} />
									</button>
									{selected.id === "local" && (
										<button
											type="button"
											aria-label={`Delete ${icon.name}`}
											disabled={loading}
											onClick={() => void remove(icon.id, true)}
										>
											×
										</button>
									)}
								</li>
							))
						) : (
							<li className="icon-library-empty">
								{loading
									? t("iconLib.loadingIcons")
									: search
										? "No matching icons."
										: "No icons in this group. Select picture to add artwork."}
								{!loading && search && (
									<button type="button" onClick={() => setQuery("")}>
										Clear search
									</button>
								)}
							</li>
						)}
					</ul>
				</div>
				{loading && !choosing.current && (
					<div className="icon-library-loading" role="status">
						<span>{t(stage)}</span>
						<progress
							max={100}
							value={progress}
							aria-label={t("iconLib.loadingIcons")}
						/>
						<span>{progress}%</span>
					</div>
				)}
			</div>
			<footer className="icon-library-footer">
				{loading && choosing.current && (
					<span role="status">{t("iconLib.loadingIcons")}</span>
				)}
				<button
					type="button"
					disabled={loading}
					onClick={() => void upload("import-pack")}
					title={t("iconLib.iconPackSupportType")}
				>
					{t("iconLib.importIcon")}
				</button>
				<button
					type="button"
					disabled={loading}
					onClick={() => void upload("import-icon")}
				>
					Select picture
				</button>
				<div className="icon-library-zoom">
					<span>{zoom}px</span>
					<button
						type="button"
						aria-label="Zoom out"
						disabled={zoom <= 40 || loading}
						onClick={() => setZoom((size) => Math.max(40, size - 8))}
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
						disabled={loading}
						onChange={(event) => setZoom(Number(event.target.value))}
					/>
					<button
						type="button"
						aria-label="Zoom in"
						disabled={zoom >= 120 || loading}
						onClick={() => setZoom((size) => Math.min(120, size + 8))}
					>
						+
					</button>
				</div>
			</footer>
			{status && (
				<div className="icon-library-notice" role="alert">
					<span>{status}</span>
					<button
						type="button"
						disabled={loading}
						onClick={() => setRetry((value) => value + 1)}
					>
						Retry
					</button>
				</div>
			)}
			{notice && (
				<p className="icon-library-notice" role="status">
					{notice}
				</p>
			)}
		</section>
	);
}
