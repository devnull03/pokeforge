// Launcher: print immediately so you see output before Stagehand loads (tsx can buffer)
process.stdout.write("Starting Stagehand...\n");
process.stdout.write("Connecting to Browserbase...\n");
await import("./index.ts");
