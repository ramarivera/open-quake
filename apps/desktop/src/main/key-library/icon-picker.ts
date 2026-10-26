import { join } from "node:path";
import { BrowserWindow, type IpcMainInvokeEvent, nativeImage } from "electron";
import type { ProfileLocale } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import type { KeyReply } from "../../shared/key-library";

/** Chromium decodes GIF/WebP that nativeImage cannot decode on every platform. */
export async function decodeIconPicture(
	bytes: Buffer,
	raster: (bytes: Buffer) => string,
): Promise<string> {
	if (bytes.length > 5 * 1024 * 1024) throw new Error("Image too large");
	const gif = /^GIF8[79]a$/.test(bytes.toString("ascii", 0, 6));
	const webp =
		bytes.toString("ascii", 0, 4) === "RIFF" &&
		bytes.toString("ascii", 8, 12) === "WEBP";
	if (!gif && !webp) return raster(bytes);
	const window = new BrowserWindow({
		show: false,
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true,
		},
	});
	window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	window.webContents.on("will-navigate", (event) => event.preventDefault());
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			(async () => {
				await window.loadURL(
					`data:text/html,${encodeURIComponent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:">')}`,
				);
				const data: unknown = await window.webContents.executeJavaScript(
					`(async()=>{const image=new Image();image.src=${JSON.stringify(`data:image/${gif ? "gif" : "webp"};base64,${bytes.toString("base64")}`)};await image.decode();if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>16000000)throw new Error('Invalid image');const canvas=document.createElement('canvas');const scale=Math.min(1024/image.naturalWidth,1024/image.naturalHeight,1);canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png')})()`,
				);
				if (
					typeof data !== "string" ||
					data.length > 8 * 1024 * 1024 ||
					!data.startsWith("data:image/png;base64,")
				)
					throw new Error("Invalid image");
				return data;
			})(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("Image decode timed out")),
					6000,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
		if (!window.isDestroyed()) window.destroy();
	}
}

type Picker = {
	readonly token: string;
	readonly url: string;
	readonly window: BrowserWindow;
	readonly resolve: (reply: KeyReply) => void;
};

/** One owned chooser; its result carries pixels and never executable SVG or paths. */
export function createIconPicker(
	management: () => BrowserWindow | undefined,
	renderer: string,
) {
	let active: Picker | undefined;
	const finish = (picker: Picker, reply: KeyReply): void => {
		if (active !== picker) return;
		active = undefined;
		picker.resolve(reply);
		if (!picker.window.isDestroyed()) picker.window.destroy();
	};
	const cancel = (token?: string): void => {
		if (active && (token === undefined || token === active.token))
			finish(active, { _tag: "success" });
	};
	const owns = (event: IpcMainInvokeEvent): boolean =>
		!!active &&
		!active.window.isDestroyed() &&
		event.sender === active.window.webContents &&
		event.senderFrame === event.sender.mainFrame &&
		!event.sender.isDestroyed() &&
		event.sender.getURL() === active.url;
	const open = (token: string, locale: ProfileLocale): Promise<KeyReply> => {
		cancel();
		const parent = management();
		if (!parent || parent.isDestroyed())
			return Promise.resolve({
				_tag: "rejected",
				reason: "Icon Library is unavailable.",
			});
		const url = new URL(renderer);
		url.searchParams.set("surface", "icons");
		url.searchParams.set("token", token);
		url.searchParams.set("locale", locale);
		const window = new BrowserWindow({
			parent,
			width: 600,
			height: 550,
			minWidth: 600,
			minHeight: 550,
			resizable: true,
			title: "Icon Library",
			backgroundColor: "#09090b",
			autoHideMenuBar: true,
			show: false,
			webPreferences: {
				preload: join(import.meta.dirname, "../preload/index.mjs"),
				sandbox: false,
				contextIsolation: true,
				nodeIntegration: false,
				webSecurity: true,
				allowRunningInsecureContent: false,
			},
		});
		return new Promise((resolve) => {
			const picker: Picker = { token, url: url.href, window, resolve };
			active = picker;
			window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
			window.webContents.on("will-navigate", (event, destination) => {
				if (destination !== picker.url) event.preventDefault();
			});
			window.webContents.on("will-attach-webview", (event) =>
				event.preventDefault(),
			);
			window.once("closed", () => finish(picker, { _tag: "success" }));
			window.once("ready-to-show", () => {
				if (active !== picker || window.isDestroyed()) return;
				if (process.env.OPEN_QUAKE_MOCK_DEVICE === "1") window.showInactive();
				else window.show();
			});
			void window.loadURL(picker.url).catch(() =>
				finish(picker, {
					_tag: "rejected",
					reason: "Could not open Icon Library.",
				}),
			);
		});
	};
	const choose = (
		event: IpcMainInvokeEvent,
		token: string,
		data: string,
		source?: string,
	): KeyReply => {
		const picker = active;
		if (!picker || picker.token !== token || !owns(event))
			return { _tag: "rejected", reason: "unauthorized" };
		if (
			!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data) ||
			data.length > 8 * 1024 * 1024
		)
			return { _tag: "rejected", reason: "Invalid icon image." };
		const image = nativeImage.createFromDataURL(data);
		const size = image.getSize();
		if (image.isEmpty() || size.width !== 170 || size.height !== 170)
			return { _tag: "rejected", reason: "Invalid icon image." };
		finish(picker, {
			_tag: "success",
			icon: image.toDataURL(),
			...(source ? { iconSource: source } : {}),
		});
		return { _tag: "success" };
	};
	return { open, owns, choose, cancel };
}
