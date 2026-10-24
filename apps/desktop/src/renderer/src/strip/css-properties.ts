import "react";

// Lets strip components set `--strip-*` custom properties in typed style objects.
declare module "react" {
	interface CSSProperties {
		[property: `--${string}`]: string | number | undefined;
	}
}
