import { Schema } from "effect";

export const MANAGEMENT_THEME = "management:theme";
export const MANAGEMENT_ACTIVATE = "management:activate";
export const NativeThemeRequest = Schema.Struct({
	base: Schema.Literal("dark", "light"),
	titlebar: Schema.String.pipe(Schema.pattern(/^#[0-9a-f]{6}$/i)),
	background: Schema.String.pipe(Schema.pattern(/^#[0-9a-f]{6}$/i)),
	symbol: Schema.String.pipe(Schema.pattern(/^#[0-9a-f]{6}$/i)),
});
export interface ManagementBridge {
	readonly platform: string;
	readonly setTheme: (
		theme: typeof NativeThemeRequest.Type,
	) => Promise<boolean>;
	readonly onActivate: (receive: (page: string) => void) => () => void;
}
declare global {
	interface Window {
		readonly quakeManagement?: ManagementBridge;
	}
}
