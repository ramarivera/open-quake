import { expect, it } from "vitest";
import { CHANNEL_CATALOG, localizedChannelCatalog } from "./channel-catalog";

it("CENTER-072/073 preserve all recovered setup contracts in both groups for eight locales and English fallback", () => {
	const contracts = CHANNEL_CATALOG.map((d) => [
		d.id,
		d.region,
		d.setupType,
		d.minHostVersion,
		d.installSpec,
		d.installSpecFallback ?? "",
		d.pluginEntryId ?? "",
		d.bundled,
	]);
	expect(contracts).toEqual([
		[
			"feishu",
			"China",
			"credentials_or_qr",
			"2026.5.29",
			"@openclaw/feishu",
			"",
			"",
			true,
		],
		[
			"qqbot",
			"China",
			"app_id_secret",
			"2026.4.10",
			"@openclaw/qqbot",
			"",
			"",
			true,
		],
		[
			"openclaw-weixin",
			"China",
			"qr_login",
			"2026.5.12",
			"@tencent-weixin/openclaw-weixin",
			"",
			"openclaw-weixin",
			false,
		],
		[
			"wecom",
			"China",
			"wecom_bot_credentials",
			"2026.5.7",
			"@wecom/wecom-openclaw-plugin",
			"",
			"wecom-openclaw-plugin",
			false,
		],
		[
			"whatsapp",
			"International",
			"qr_login",
			"2026.4.25",
			"clawhub:@openclaw/whatsapp",
			"@openclaw/whatsapp",
			"whatsapp",
			false,
		],
		[
			"discord",
			"International",
			"bot_token",
			"2026.4.10",
			"@openclaw/discord",
			"",
			"",
			true,
		],
	]);
	for (const locale of ["zh", "en", "ja", "ko", "de", "fr", "es", "it"]) {
		const descriptors = localizedChannelCatalog(locale);
		expect(
			descriptors.map((d) => [
				d.id,
				d.region,
				d.setupType,
				d.minHostVersion,
				d.installSpec,
				d.installSpecFallback ?? "",
				d.pluginEntryId ?? "",
				d.bundled,
			]),
		).toEqual(contracts);
		for (const d of descriptors) {
			expect(d.blurb.length).toBeGreaterThan(10);
			expect(d.source).not.toBe("");
			expect(d.eta).toMatch(/^~/);
		}
	}
	expect(localizedChannelCatalog("zh-CN")[0]?.source).toBe("官方内置");
	expect(localizedChannelCatalog("de-DE")[0]?.source).toBe(
		"Offiziell integriert",
	);
	expect(localizedChannelCatalog("unknown")).toEqual(
		localizedChannelCatalog("en"),
	);
});
