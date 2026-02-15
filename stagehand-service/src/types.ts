export type Bindings = {
	BROWSERBASE_PROJECT_ID: string;
	BROWSERBASE_API_KEY: string;
	ANTHROPIC_API_KEY: string;
};

export type ExecuteStep = {
	type: "observe" | "act";
	instruction: string;
};

export type ExecutePayload = {
	targetUrl: string;
	steps: ExecuteStep[];
	context?: Record<string, string | number | boolean | null>;
	inputArtifacts?: Artifact[];
	capture?: {
		screenshot?: boolean;
		htmlSnapshot?: boolean;
	};
};

export type StepResult = {
	instruction: string;
	type: "observe" | "act";
	result: unknown;
};

export type Artifact = {
	name: string;
	mimeType: string;
	encoding: "base64" | "utf8";
	content: string;
};

export type ExecuteResult = {
	steps: StepResult[];
	logs: string;
	metadata: {
		cacheKey: string;
		sessionId?: string;
		targetUrl: string;
		finalUrl?: string;
		context?: Record<string, string | number | boolean | null>;
		receivedArtifactCount?: number;
	};
	artifacts: Artifact[];
	error?: string;
};
