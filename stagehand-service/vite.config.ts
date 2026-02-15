import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const wsShimPath = fileURLToPath(new URL("./src/shims/ws.ts", import.meta.url));

export default defineConfig({
	plugins: [cloudflare()],
	resolve: {
		// Prevent packages like `ws` from resolving to browser-only shims.
		conditions: ["workerd", "worker", "node", "module"],
		alias: {
			ws: resolve(wsShimPath),
		},
	},
});
