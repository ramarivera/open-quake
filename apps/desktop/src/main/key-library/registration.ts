import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { Effect, Fiber, type ManagedRuntime, Schema, Stream } from "effect";
import { app, BrowserWindow, dialog, ipcMain, nativeImage } from "electron";
import type { ActionError } from "../../../../../packages/device/src/actions/action-errors.js";
import { KeyRuntime } from "../../../../../packages/device/src/actions/key-runtime-service.js";
import { iconInUse } from "../../../../../packages/device/src/profiles/key-editing-invariants.js";
import { KeyEditing } from "../../../../../packages/device/src/profiles/key-editing-service.js";
import {
	encodeProfileEnvelope,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import type { ProfileRepositoryError } from "../../../../../packages/device/src/profiles/profile-errors.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import {
	KEY_PREVIEW,
	KEY_REQUEST,
	type KeyReply,
	KeyRequest,
} from "../../shared/key-library";
import { isAppRenderer } from "../profiles/profile-ipc";
import { applicationIconLibrary } from "./application-icons";
import { renderFontIcons } from "./font-renderer";
import { IconImportFailed, type IconStorageFailed } from "./icon-errors";
import {
	type IconAsset,
	type IconPack,
	parseIconPack,
	svgData,
} from "./icon-packs";
import { createIconPicker } from "./icon-picker";
import { iconStore } from "./icon-store";

type PreparedImport =
	| { readonly pack: IconPack }
	| { readonly icon: IconAsset }
	| undefined;

const imageData = (bytes: Buffer): string => {
	if (bytes.length > 5 * 1024 * 1024) throw new Error("Image too large");
	const image = nativeImage.createFromBuffer(bytes),
		size = image.getSize();
	if (image.isEmpty() || size.width * size.height > 16000000)
		throw new Error("Invalid image");
	return image.toDataURL();
};
export function registerKeyLibrary<R>(
	runtime: ManagedRuntime.ManagedRuntime<
		R | ProfileService | KeyEditing | KeyRuntime,
		never
	>,
	management: () => BrowserWindow | undefined,
	renderer: string,
	managementURL = renderer,
	panelWindow: () => BrowserWindow | undefined = () => undefined,
) {
	const store = iconStore(join(app.getPath("userData"), "key-library-v1.json"));
	const picker = createIconPicker(management, renderer);
	const applicationIcons = applicationIconLibrary();
	const lock = runtime.runSync(Effect.makeSemaphore(1));
	const publish = Effect.gen(function* () {
		const envelope = yield* KeyEditing.read();
		const value = { envelope: encodeProfileEnvelope(envelope) };
		for (const win of BrowserWindow.getAllWindows())
			if (!win.isDestroyed() && !win.webContents.isDestroyed())
				win.webContents.send(KEY_PREVIEW, value);
	});
	const updates = runtime.runFork(
		ProfileService.subscribeCommittedProfiles().pipe(
			Effect.flatMap((stream) =>
				Stream.runForEach(stream, (envelope) =>
					Effect.gen(function* () {
						yield* publish;
						for (const deviceId of new Set([
							"desktop-preview",
							...Object.keys(envelope.activeByDevice),
						]))
							yield* KeyRuntime.refresh(deviceId).pipe(Effect.ignore);
					}).pipe(Effect.ignore),
				),
			),
		),
	);
	let disposed = false;
	const pending = new Set<Promise<unknown>>();
	const owners = new Map<number, () => void>();
	const track = async <A>(operation: Promise<A>): Promise<A> => {
		pending.add(operation);
		try {
			return await operation;
		} finally {
			pending.delete(operation);
		}
	};
	const clearDraft = (): void => {
		picker.cancel();
		if (!disposed)
			void track(
				runtime.runPromise(
					KeyEditing.discard().pipe(
						Effect.zipRight(publish),
						lock.withPermits(1),
						Effect.ignore,
					),
				),
			);
	};

	const authorized = (
		event: Electron.IpcMainInvokeEvent,
		command: KeyRequest,
	): boolean => {
		if (
			disposed ||
			event.sender.isDestroyed() ||
			event.senderFrame !== event.sender.mainFrame ||
			!BrowserWindow.fromWebContents(event.sender) ||
			!isAppRenderer(event.sender.getURL(), renderer)
		)
			return false;
		if (
			["import-pack", "import-icon", "remove-pack", "remove-icon"].includes(
				command.type,
			)
		)
			return picker.owns(event);
		if (
			event.sender === management()?.webContents &&
			event.sender.getURL() === new URL(managementURL).href
		)
			return true;
		if (command.type === "read") return true;
		if (picker.owns(event))
			return [
				"icons",
				"application-icons",
				"import-pack",
				"import-icon",
				"remove-pack",
				"remove-icon",
				"pick-icon",
				"cancel-icons",
			].includes(command.type);
		return (
			(command.type === "activate" || command.type === "navigate") &&
			event.sender === panelWindow()?.webContents &&
			new URL(event.sender.getURL()).searchParams.get("surface") === "panel"
		);
	};

	ipcMain.handle(
		KEY_REQUEST,
		async (event, input: unknown): Promise<KeyReply> => {
			const decoded = Schema.decodeUnknownEither(KeyRequest)(input, {
				onExcessProperty: "error",
			});
			if (decoded._tag === "Left" || !authorized(event, decoded.right))
				return { _tag: "rejected", reason: "unauthorized" };
			const command = decoded.right;
			const privileged =
				event.sender === management()?.webContents &&
				event.sender.getURL() === new URL(managementURL).href;

			if (privileged && !owners.has(event.sender.id)) {
				const sender = event.sender;
				const navigation = (
					_event: Electron.Event,
					_url: string,
					_inPlace: boolean,
					main: boolean,
				): void => {
					if (main) clearDraft();
				};
				sender.on("did-start-navigation", navigation);
				sender.once("destroyed", clearDraft);
				owners.set(sender.id, () => {
					sender.removeListener("did-start-navigation", navigation);
					sender.removeListener("destroyed", clearDraft);
				});
			}
			// The chooser awaits another renderer; it cannot hold the request lock.
			if (command.type === "open-icons")
				return privileged
					? track(picker.open(command.token, command.locale))
					: { _tag: "rejected", reason: "unauthorized" };
			if (command.type === "cancel-icons") {
				picker.cancel(command.token);
				return { _tag: "success" };
			}
			if (command.type === "pick-icon")
				return picker.choose(
					event,
					command.token,
					command.data,
					command.source,
				);
			// Host scans cannot reserve the live key/profile request semaphore.
			if (command.type === "application-icons")
				return track(
					applicationIcons().then(
						(pack): KeyReply =>
							authorized(event, command)
								? { _tag: "success", packs: [pack] }
								: { _tag: "rejected", reason: "unauthorized" },
						(cause: unknown): KeyReply => ({
							_tag: "rejected",
							reason: new IconImportFailed(cause).code,
						}),
					),
				);
			const preparation = Effect.gen(function* (): Effect.fn.Return<
				PreparedImport,
				IconImportFailed
			> {
				if (command.type !== "import-icon" && command.type !== "import-pack")
					return undefined;
				const owner = BrowserWindow.fromWebContents(event.sender);
				if (!owner) return undefined;
				const result = yield* Effect.tryPromise({
					try: () =>
						dialog.showOpenDialog(owner, {
							title:
								command.type === "import-pack"
									? "Import Icon"
									: "Select Picture",
							properties: ["openFile"],
							filters: [
								{
									name: "Icons",
									extensions:
										command.type === "import-pack"
											? ["zip"]
											: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
								},
							],
						}),
					catch: (c) => new IconImportFailed(c),
				});
				const path = result.filePaths[0];
				if (result.canceled || !path || !authorized(event, command))
					return undefined;
				const bytes = yield* Effect.tryPromise({
					try: async () => {
						const info = await stat(path);
						if (!info.isFile() || info.size > 32 * 1024 * 1024)
							throw new IconImportFailed(undefined);
						return readFile(path);
					},
					catch: (c) => new IconImportFailed(c),
				});
				yield* Effect.try({
					try: () => {
						if (bytes.length > 32 * 1024 * 1024)
							throw new Error("Invalid icon pack");
					},
					catch: (c) => new IconImportFailed(c),
				});
				if (command.type === "import-pack") {
					const pack = yield* Effect.tryPromise({
						try: () => parseIconPack(bytes, imageData, renderFontIcons),
						catch: (c) => new IconImportFailed(c),
					});
					return { pack };
				} else {
					const data = yield* Effect.try({
						try: () =>
							/\.svg$/i.test(path)
								? svgData(
										bytes.toString("utf8").replace(/^\s*<\?xml[^>]*>\s*/, ""),
									)
								: imageData(bytes),
						catch: (c) => new IconImportFailed(c),
					});
					return {
						icon: {
							id: createHash("sha256").update(data).digest("hex"),
							name: basename(path),
							tags: [],
							data,
						},
					};
				}
			});
			const program = (prepared: PreparedImport) =>
				Effect.gen(function* (): Effect.fn.Return<
					KeyReply,
					| ProfileRepositoryError
					| ActionError
					| IconImportFailed
					| IconStorageFailed,
					ProfileService | KeyEditing | KeyRuntime
				> {
					switch (command.type) {
						case "read":
							return {
								_tag: "success",
								envelope: encodeProfileEnvelope(yield* KeyEditing.read()),
								states: yield* KeyRuntime.snapshot,
							};
						case "select":
							yield* KeyEditing.discard();
							yield* ProfileService.selectProfile({
								deviceId: command.deviceId,
								profileId: command.profileId,
								pageId: command.pageId,
							});
							yield* KeyRuntime.refresh(command.deviceId);
							break;
						case "preview":
							yield* KeyEditing.preview(command.target, command.key);
							break;
						case "save":
							yield* KeyEditing.save(command.token);
							break;
						case "revert":
							yield* KeyEditing.revert(command.token);
							break;
						case "delete":
							yield* KeyEditing.remove(command.target);
							break;
						case "activate":
							yield* KeyRuntime.activate(
								command.deviceId,
								command.keyCode,
								command.kind,
								{
									profileId: command.profileId,
									pageId: command.pageId,
									revision: command.revision,
								},
							);
							return { _tag: "success" };
						case "navigate":
							yield* KeyRuntime.navigate(command.deviceId, command.direction);
							return { _tag: "success" };
						case "icons":
							return { _tag: "success", packs: yield* store.read() };
						case "import-icon":
						case "import-pack": {
							if (prepared) {
								if ("pack" in prepared) yield* store.add(prepared.pack);
								else yield* store.addLocal(prepared.icon);
							}
							return { _tag: "success", packs: yield* store.read() };
						}
						case "remove-icon":
						case "remove-pack": {
							const packs = yield* store.read();
							const selected =
								command.type === "remove-pack"
									? packs.find((p) => p.id === command.id)?.icons
									: (packs.find((p) => p.id === "local")?.icons ?? []).filter(
											(i) => i.id === command.id,
										);
							if (command.type === "remove-icon" && !selected?.length)
								return {
									_tag: "rejected",
									reason: "Only local icons can be deleted individually.",
								};
							const refs = new Set(selected?.map((i) => i.data) ?? []);
							const pending = yield* KeyEditing.pending;
							const saved = yield* ProfileService.loadProfiles();
							if (
								iconInUse(
									Schema.encodeSync(ProfileEnvelope)(saved.envelope),
									refs,
								) ||
								iconInUse(pending, refs)
							)
								return {
									_tag: "rejected",
									reason:
										"This icon is currently in use and cannot be deleted.",
								};
							yield* store.write(
								command.type === "remove-pack"
									? packs.filter((p) => p.id !== command.id)
									: packs.map((p) => ({
											...p,
											icons:
												p.id === "local"
													? p.icons.filter((i) => i.id !== command.id)
													: p.icons,
										})),
							);
							return { _tag: "success", packs: yield* store.read() };
						}
					}
					yield* publish;
					return {
						_tag: "success",
						envelope: encodeProfileEnvelope(yield* KeyEditing.read()),
					};
				});
			return track(
				runtime.runPromise(
					Effect.flatMap(preparation, (prepared) =>
						Effect.suspend(() =>
							!authorized(event, command)
								? Effect.succeed<KeyReply>({
										_tag: "rejected",
										reason: "unauthorized",
									})
								: program(prepared),
						).pipe(lock.withPermits(1)),
					).pipe(
						Effect.match({
							onSuccess: (r) => r,
							onFailure: (cause): KeyReply => ({
								_tag: "rejected",
								reason:
									typeof cause === "object" &&
									cause !== null &&
									"code" in cause &&
									typeof cause.code === "string"
										? cause.code
										: "Invalid icon pack",
							}),
						}),
					),
				),
			);
		},
	);
	return {
		dispose: async () => {
			disposed = true;
			picker.cancel();
			ipcMain.removeHandler(KEY_REQUEST);
			for (const cleanup of owners.values()) cleanup();
			owners.clear();
			await Promise.allSettled([...pending]);
			await runtime.runPromise(KeyEditing.discard());
			await runtime.runPromise(Fiber.interrupt(updates));
			await runtime.runPromise(KeyRuntime.reset());
		},
	};
}
