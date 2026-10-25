import { Rpc, RpcGroup } from "@effect/rpc";
import { AppLocale, LocaleSnapshot } from "./settings-contracts.js";
import { SettingsFailure } from "./settings-errors.js";
export const SettingsRpcs = RpcGroup.make(
	Rpc.make("settings.locale", {
		success: LocaleSnapshot,
		error: SettingsFailure,
	}),
	Rpc.make("settings.setLocale", {
		payload: { locale: AppLocale },
		success: LocaleSnapshot,
		error: SettingsFailure,
	}),
);
export { RpcClient, RpcClientError, RpcServer } from "@effect/rpc";
export type {
	FromClientEncoded,
	FromServerEncoded,
} from "@effect/rpc/RpcMessage";
