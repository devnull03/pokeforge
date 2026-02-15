declare module "@cloudflare/sandbox" {
	type ExecResult = {
		stdout: string;
		stderr: string;
		exitCode: number;
		success: boolean;
	};

	type SandboxInstance = {
		exec(command: string): Promise<ExecResult>;
		writeFile(path: string, content: string): Promise<void>;
		destroy(): Promise<void>;
	};

	export function getSandbox(namespace: DurableObjectNamespace, id: string): SandboxInstance;
	export const Sandbox: unknown;
}
