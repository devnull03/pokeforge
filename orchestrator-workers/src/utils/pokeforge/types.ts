export type DiscoveryAction = {
	instruction: string;
	type: string;
	result: string;
};

export type StagehandArtifact = {
	name: string;
	mimeType: string;
	encoding: "base64" | "utf8";
	content: string;
};

export type StagehandContext = Record<string, string | number | boolean | null>;

export type DiscoveryResult = {
	actions: DiscoveryAction[];
	logs: string;
	cacheKey: string;
	sessionId?: string;
	context?: StagehandContext;
	receivedArtifactCount?: number;
	artifacts: StagehandArtifact[];
	error?: string;
};

export type GeneratedMcpServer = {
	indexTs: string;
	wranglerJsonc: string;
	packageJson: string;
};
