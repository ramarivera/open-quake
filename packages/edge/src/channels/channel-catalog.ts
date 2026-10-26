import type { ChannelDescriptor } from "./channel-contracts.js";
import metadata from "./channel-locales.json";
/** CENTER-072/073, recovered background.js channel catalog, all regions visible. */
export const CHANNEL_CATALOG: readonly ChannelDescriptor[] = [
	{
		id: "feishu",
		name: "Feishu",
		region: "China",
		icon: "📘",
		source: "Official bundled",
		blurb: "Enterprise messaging with DM and group chat",
		eta: "~2 min",
		setupType: "credentials_or_qr",
		installSpec: "@openclaw/feishu",
		bundled: true,
		docsUrl: "https://open.feishu.cn/",
		platformUrl: "https://open.feishu.cn/app",
		minHostVersion: "2026.5.29",
	},
	{
		id: "qqbot",
		name: "QQ Bot",
		region: "China",
		icon: "🐧",
		source: "Official bundled",
		blurb: "Official QQ Bot API for DM and groups",
		eta: "~3 min",
		setupType: "app_id_secret",
		installSpec: "@openclaw/qqbot",
		bundled: true,
		docsUrl: "https://q.qq.com/",
		platformUrl: "https://q.qq.com/",
		minHostVersion: "2026.4.10",
	},
	{
		id: "openclaw-weixin",
		name: "WeChat",
		region: "China",
		icon: "💬",
		source: "Tencent official",
		blurb: "QR login for personal chat (Tencent official plugin)",
		eta: "~1 min",
		setupType: "qr_login",
		installSpec: "@tencent-weixin/openclaw-weixin",
		bundled: false,
		pluginEntryId: "openclaw-weixin",
		docsUrl: "",
		platformUrl: "",
		minHostVersion: "2026.5.12",
	},
	{
		id: "wecom",
		name: "WeCom",
		region: "China",
		icon: "🏢",
		source: "Tencent official",
		blurb: "Enterprise WeChat messaging",
		eta: "~5 min",
		setupType: "wecom_bot_credentials",
		installSpec: "@wecom/wecom-openclaw-plugin",
		bundled: false,
		pluginEntryId: "wecom-openclaw-plugin",
		docsUrl: "",
		platformUrl: "https://open.work.weixin.qq.com/help?doc_id=21657",
		minHostVersion: "2026.5.7",
	},
	{
		id: "whatsapp",
		name: "WhatsApp",
		region: "International",
		icon: "📱",
		source: "Official plugin",
		blurb: "Link via QR to WhatsApp Web",
		eta: "~2 min",
		setupType: "qr_login",
		installSpec: "clawhub:@openclaw/whatsapp",
		installSpecFallback: "@openclaw/whatsapp",
		bundled: false,
		pluginEntryId: "whatsapp",
		docsUrl: "",
		platformUrl: "",
		minHostVersion: "2026.4.25",
	},
	{
		id: "discord",
		name: "Discord",
		region: "International",
		icon: "🎮",
		source: "Official bundled",
		blurb: "Discord bot for DMs and servers",
		eta: "~3 min",
		setupType: "bot_token",
		installSpec: "@openclaw/discord",
		bundled: true,
		docsUrl: "https://discord.com/developers/applications",
		platformUrl: "https://discord.com/developers/applications",
		minHostVersion: "2026.4.10",
	},
];
export const channelDescriptor = (id: string) =>
	CHANNEL_CATALOG.find((entry) => entry.id === id);
export const credentialFields = (
	id: string,
): readonly {
	readonly key: string;
	readonly label: string;
	readonly secret: boolean;
}[] => {
	switch (id) {
		case "feishu":
			return [
				{ key: "appId", label: "App ID", secret: false },
				{ key: "appSecret", label: "App Secret", secret: true },
			];
		case "qqbot":
			return [
				{ key: "appId", label: "App ID", secret: false },
				{ key: "clientSecret", label: "App Secret", secret: true },
			];
		case "discord":
			return [{ key: "token", label: "Bot Token", secret: true }];
		case "wecom":
			return [
				{ key: "botId", label: "Bot ID", secret: false },
				{ key: "secret", label: "Secret", secret: true },
			];
		default:
			return [];
	}
};
export const maskSecret = (value: string) =>
	value ? `••••${value.slice(-4)}` : "";

/** CENTER-072/073. Metadata transcribed from DK-Suite 0.4.95's recovered catalog. */
export function localizedChannelCatalog(
	locale: string,
): readonly ChannelDescriptor[] {
	const language = locale.toLowerCase().split(/[-_]/)[0];
	const key =
		language === "zh" ||
		language === "ja" ||
		language === "ko" ||
		language === "de" ||
		language === "fr" ||
		language === "es" ||
		language === "it"
			? language
			: "en";
	return CHANNEL_CATALOG.map((entry) => ({
		...entry,
		...metadata[entry.id][key],
	}));
}
