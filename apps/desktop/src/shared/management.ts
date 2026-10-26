import { Schema } from "effect";

export const MANAGEMENT_THEME = "management:theme";
export const MANAGEMENT_ACTIVATE = "management:activate";
export const MANAGEMENT_EXTERNAL = "management:external";
export const MANAGEMENT_COMMAND = "management:command";
export const MANAGEMENT_DEVICES = "management:devices";
export const DeviceChoice = Schema.Struct({
	serial: Schema.NonEmptyString.pipe(Schema.maxLength(128)),
	session: Schema.NonEmptyString.pipe(Schema.maxLength(128)),
});
export const DeviceChoices = Schema.Struct({
	selected: Schema.NullOr(Schema.NonEmptyString.pipe(Schema.maxLength(128))),
	devices: Schema.Array(DeviceChoice).pipe(Schema.maxItems(64)),
});
export const DeviceChoiceRequest = Schema.Union(
	Schema.Struct({ action: Schema.Literal("read") }),
	Schema.Struct({ action: Schema.Literal("select"), device: DeviceChoice }),
);
export const ShellCommand = Schema.Struct({
	action: Schema.Literal("minimize", "maximize", "hide", "quit", "restart"),
});
export const NativeThemeRequest = Schema.Struct({
	base: Schema.Literal("dark", "light"),
	titlebar: Schema.String.pipe(Schema.pattern(/^#[0-9a-f]{6}$/i)),
	background: Schema.String.pipe(Schema.pattern(/^#[0-9a-f]{6}$/i)),
	symbol: Schema.String.pipe(Schema.pattern(/^#[0-9a-f]{6}$/i)),
});
export interface ManagementBridge {
	readonly platform: string;
	readonly devices?: (
		request: typeof DeviceChoiceRequest.Type,
	) => Promise<unknown>;
	readonly command?: (command: typeof ShellCommand.Type) => Promise<boolean>;
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
