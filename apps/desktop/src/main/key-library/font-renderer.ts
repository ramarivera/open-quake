import { createHash } from "node:crypto";
import { Schema } from "effect";
import { BrowserWindow } from "electron";
import { IconAsset } from "./icon-packs";
/** Chromium decodes user-selected font bytes in a hidden, network-disabled document. */
export async function renderFontIcons(
	font: Buffer,
	glyphs: readonly { name: string; font_class: string; unicode: string }[],
): Promise<readonly IconAsset[]> {
	if (
		font.length > 5 * 1024 * 1024 ||
		glyphs.length > 8000 ||
		!glyphs.every(
			(g) =>
				/^[a-f0-9]{1,6}$/i.test(g.unicode) &&
				Number.parseInt(g.unicode, 16) <= 0x10ffff,
		)
	)
		throw new Error("Invalid icon pack");
	const win = new BrowserWindow({
		show: false,
		width: 170,
		height: 170,
		webPreferences: {
			sandbox: true,
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false,
		},
	});
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await win.loadURL(
			`data:text/html,${encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; font-src data:; script-src \'none\'"><canvas width="170" height="170"></canvas>')}`,
		);
		const input = {
			font: `data:font/ttf;base64,${font.toString("base64")}`,
			glyphs,
		};
		const result: unknown = await Promise.race([
			win.webContents.executeJavaScript(`(async()=>{
   const input=${JSON.stringify(input)};
   const face=new FontFace("ImportedIcons",'url("'+input.font+'")');await face.load();document.fonts.add(face);
   const canvas=document.querySelector("canvas"),ctx=canvas.getContext("2d");ctx.fillStyle="white";ctx.textAlign="center";ctx.textBaseline="middle";ctx.font='136px "ImportedIcons"';
   const icons=[];for(let i=0;i<input.glyphs.length;i++) {const g=input.glyphs[i];ctx.clearRect(0,0,170,170);ctx.fillText(String.fromCodePoint(parseInt(g.unicode,16)),85,85);icons.push({id:"",name:g.name,tags:[g.font_class,g.unicode],data:canvas.toDataURL("image/png")});if(i%100===0)await new Promise(resolve=>setTimeout(resolve,0))}return icons;
  })()`),
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error("Font rendering timed out")),
					15000,
				);
				timeout.unref();
			}),
		]);
		return Schema.decodeUnknownSync(Schema.Array(IconAsset))(result).map(
			(icon) => ({
				...icon,
				id: createHash("sha256").update(icon.data).digest("hex"),
			}),
		);
	} finally {
		if (timeout) clearTimeout(timeout);
		if (!win.isDestroyed()) win.destroy();
	}
}
