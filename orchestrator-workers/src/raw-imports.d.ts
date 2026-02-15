/** Vite ?raw imports — inlines file content as a string at build time */
declare module "*.mjs?raw" {
	const content: string;
	export default content;
}
declare module "*.js?raw" {
	const content: string;
	export default content;
}
