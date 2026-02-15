declare module "@browserbasehq/stagehand" {
	export class Stagehand {
		constructor(config: Record<string, unknown>);
		browserbaseSessionId?: string;
		context: {
			pages(): Array<{
				goto(url: string, options?: { timeout?: number }): Promise<void>;
			}>;
		};
		init(): Promise<void>;
		observe(instruction: string): Promise<unknown>;
		act(instruction: string): Promise<unknown>;
		close(): Promise<void>;
	}
}
