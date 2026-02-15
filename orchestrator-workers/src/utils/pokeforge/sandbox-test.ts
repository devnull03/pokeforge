import { getSandbox } from "@cloudflare/sandbox";
import type { GeneratedMcpServer } from "./types";

export async function validateGeneratedCodeInSandbox(args: {
	sandboxNamespace: DurableObjectNamespace;
	sandboxId: string;
	generated: GeneratedMcpServer;
}): Promise<void> {
	const { sandboxNamespace, sandboxId, generated } = args;
	const sandbox = getSandbox(sandboxNamespace, sandboxId);

	try {
		await sandbox.exec("mkdir -p /workspace/src");
		await sandbox.writeFile("/workspace/package.json", generated.packageJson);
		await sandbox.writeFile("/workspace/src/index.ts", generated.indexTs);
		await sandbox.writeFile(
			"/workspace/tsconfig.json",
			JSON.stringify(
				{
					compilerOptions: {
						target: "ES2022",
						module: "NodeNext",
						moduleResolution: "NodeNext",
						strict: true,
						skipLibCheck: true,
						noEmit: true,
					},
					include: ["src/**/*.ts"],
				},
				null,
				2,
			),
		);

		const installResult = await sandbox.exec("cd /workspace && bun install");
		if (!installResult.success) {
			throw new Error(
				`Sandbox bun install failed (exit ${installResult.exitCode}): ${installResult.stderr || installResult.stdout}`,
			);
		}

		const typecheckResult = await sandbox.exec("cd /workspace && bunx tsc --noEmit");
		if (!typecheckResult.success) {
			throw new Error(
				`Generated code failed validation (exit ${typecheckResult.exitCode}): ${typecheckResult.stderr || typecheckResult.stdout}`,
			);
		}
	} finally {
		await sandbox.destroy();
	}
}
