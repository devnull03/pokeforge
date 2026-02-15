import { z } from "zod";

export const ProbeParamsSchema = z.object({
	websiteUrl: z.url().optional(),
	task: z.string().optional(),
	cacheDir: z.string().optional(),
	modelName: z.string().optional(),
	aiProvider: z.enum(["openai", "anthropic", "google"]).optional(),
	maxFiles: z.number().int().positive().optional(),
	// Functions secrets are not GA yet, so pass these as params for now.
	browserbaseProjectId: z.string().optional(),
	browserbaseApiKey: z.string().optional(),
	aiApiKey: z.string().optional(),
});

export type ProbeParams = z.infer<typeof ProbeParamsSchema>;
