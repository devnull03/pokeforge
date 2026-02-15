import { defineFn } from "@browserbasehq/sdk-functions";
import { execute } from "./src/execute.js";
import { ProbeParamsSchema } from "./src/params.js";

defineFn("stagehand-cache-probe-v1", async (ctx, rawParams) => {
	const params = ProbeParamsSchema.parse(rawParams ?? {});
	return execute(ctx, params);
});
