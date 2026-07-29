import {
	BUILT_IN_INFINIAI_MODEL_METADATA,
	type BuiltInInfiniAIModelMetadata,
} from "./generated/infiniaiCatalogMetadata.generated";
import type { InfiniAIModelInfo, ModelEndpointKind, ModelTransport } from "./types";

const BUILT_IN_INFINIAI_MODEL_METADATA_OVERRIDES: Record<string, BuiltInInfiniAIModelMetadata> = {
	"glm-5.2": {
		name: "glm-5.2",
		family: "glm-5",
		manufacturer: "智谱",
		maxContextTokens: 1000000,
		maxInputTokens: 983616,
		maxOutputTokens: 131072,
		apiMode: "openai",
		endpointKind: "chat.completions",
		detail: "智谱 · Code · Tools",
		tooltip:
			"glm-5.2\nProvider: 智谱 · 大语言模型\nCapabilities: Text, Code, Tools\nContext: 1,000,000 tokens\nMax output: 131,072 tokens\nBilling: 后付费",
		capabilities: {
			toolCalling: true,
			imageInput: false,
			codeGeneration: true,
		},
	},
};

export function getBuiltInInfiniAIModelMetadata(modelId: string): BuiltInInfiniAIModelMetadata | undefined {
	return (
		BUILT_IN_INFINIAI_MODEL_METADATA_OVERRIDES[modelId] ??
		BUILT_IN_INFINIAI_MODEL_METADATA[modelId as keyof typeof BUILT_IN_INFINIAI_MODEL_METADATA]
	);
}

export function inferModelFamily(modelId: string): string {
	const id = modelId.toLowerCase();
	const rules: Array<[RegExp, string]> = [
		[/^(pro-)?deepseek-r1/, "deepseek-r1"],
		[/^deepseek-v4/, "deepseek-v4"],
		[/^deepseek-v3\.2/, "deepseek-v3.2"],
		[/^deepseek-v3\.1/, "deepseek-v3.1"],
		[/^(pro-)?deepseek-v3/, "deepseek-v3"],
		[/^glm-5/, "glm-5"],
		[/^glm-4\.7/, "glm-4.7"],
		[/^glm-4\.6/, "glm-4.6"],
		[/^glm-4\.5/, "glm-4.5"],
		[/^kimi-k3/, "kimi-k3"],
		[/^kimi-k2/, "kimi-k2"],
		[/^mimo-v2\.5/, "mimo-v2.5"],
		[/^mimo-v2/, "mimo-v2"],
		[/^minimax-m2/, "minimax-m2"],
		[/^qwen3-vl/, "qwen3-vl"],
		[/^qwen3-next/, "qwen3-next"],
		[/^qwen3-coder/, "qwen3-coder"],
		[/^qwen3/, "qwen3"],
		[/^gpt-oss/, "gpt-oss"],
		[/^baichuan-m2/, "baichuan-m2"],
		[/^megrez-3b/, "megrez-3b"],
	];

	for (const [pattern, family] of rules) {
		if (pattern.test(id)) {
			return family;
		}
	}

	return id.split("-").filter(Boolean).slice(0, 2).join("-") || id;
}

function mergeCapabilities(
	live: InfiniAIModelInfo["capabilities"],
	builtIn: BuiltInInfiniAIModelMetadata["capabilities"]
): InfiniAIModelInfo["capabilities"] | undefined {
	if (!live && !builtIn) {
		return undefined;
	}
	return {
		...builtIn,
		...live,
	};
}

function positiveInteger(value: number | undefined): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return Math.floor(value);
}

function normalizedCreated(value: number | undefined, fallback?: number): number {
	return positiveInteger(value) ?? positiveInteger(fallback) ?? 0;
}

function normalizedOwner(value: string | undefined, fallback?: string): string {
	return value?.trim() || fallback?.trim() || "InfiniAI";
}

function refreshLiveTokenMetadata(
	tooltip: string | undefined,
	contextLength: number | undefined,
	maxOutputTokens: number | undefined
): string | undefined {
	if (!tooltip) {
		return tooltip;
	}
	let refreshed = tooltip;
	for (const [label, value] of [
		["Context", contextLength],
		["Max output", maxOutputTokens],
	] as const) {
		if (value === undefined) {
			continue;
		}
		const line = `${label}: ${value.toLocaleString("en-US")} tokens`;
		const pattern = new RegExp(`^${label}:.*$`, "m");
		refreshed = pattern.test(refreshed) ? refreshed.replace(pattern, line) : `${refreshed}\n${line}`;
	}
	return refreshed;
}

export function enrichModelWithBuiltInMetadata(model: InfiniAIModelInfo): InfiniAIModelInfo {
	const builtIn = getBuiltInInfiniAIModelMetadata(model.id);
	const liveContextLength = positiveInteger(model.context_length);
	const liveMaxOutput =
		positiveInteger(model.max_output_length) ??
		positiveInteger(model.max_tokens) ??
		positiveInteger(model.maxOutputTokens);
	if (!builtIn) {
		return {
			...model,
			created: normalizedCreated(model.created),
			owned_by: normalizedOwner(model.owned_by),
			family: model.family ?? inferModelFamily(model.id),
			max_output_length: liveMaxOutput,
			max_tokens: liveMaxOutput,
			maxOutputTokens: liveMaxOutput,
		};
	}

	const capabilities = mergeCapabilities(model.capabilities, builtIn.capabilities);
	const imageInput = capabilities?.imageInput;

	return {
		...model,
		created: normalizedCreated(model.created, builtIn.created),
		owned_by: normalizedOwner(model.owned_by, builtIn.manufacturer),
		family: model.family ?? builtIn.family ?? inferModelFamily(model.id),
		apiMode: model.apiMode ?? (builtIn.apiMode as ModelTransport | undefined),
		endpointKind: model.endpointKind ?? (builtIn.endpointKind as ModelEndpointKind | undefined),
		context_length: liveContextLength ?? builtIn.maxContextTokens,
		max_output_length: liveMaxOutput,
		max_tokens: liveMaxOutput ?? builtIn.maxOutputTokens,
		maxInputTokens: model.maxInputTokens ?? builtIn.maxInputTokens,
		maxOutputTokens: liveMaxOutput ?? builtIn.maxOutputTokens,
		displayName: model.displayName ?? builtIn.name,
		version: model.version ?? builtIn.version,
		detail: model.detail ?? builtIn.detail,
		tooltip: model.tooltip ?? refreshLiveTokenMetadata(builtIn.tooltip, liveContextLength, liveMaxOutput),
		vision: model.vision ?? imageInput,
		input_modalities: model.input_modalities ?? (imageInput ? ["text", "image"] : undefined),
		capabilities,
	};
}
