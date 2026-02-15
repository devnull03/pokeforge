import { Hono } from "hono";
import { cors } from "hono/cors";
import { handleExecute } from "./http/handlers.js";
import type { Bindings } from "./types.js";

const app = new Hono<{ Bindings: Bindings }>();
app.use(cors());

app.post("/execute", async (c) => {
	return handleExecute(c);
});

app.get("/health", (c) => c.json({ ok: true }));

export default app;
