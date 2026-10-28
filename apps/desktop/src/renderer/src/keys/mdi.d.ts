declare module "virtual:mdi-icons" {
	const icons: readonly {
		readonly name: string;
		readonly tags: readonly string[];
		readonly path: string;
	}[];
	export default icons;
}
declare module "*.svg?raw" {
	const svg: string;
	export default svg;
}
declare module "virtual:phosphor-icons" {
	const icons: readonly {
		readonly name: string;
		readonly tags: readonly string[];
		readonly svg: string;
	}[];
	export default icons;
}
