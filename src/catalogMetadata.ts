import {
	BUILT_IN_INFINIAI_MODEL_METADATA,
	BUILT_IN_INFINIAI_NON_CHAT_MODELS,
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

export function isBuiltInNonChatModel(modelId: string): boolean {
	return modelId in BUILT_IN_INFINIAI_NON_CHAT_MODELS;
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

export function enrichModelWithBuiltInMetadata(model: InfiniAIModelInfo): InfiniAIModelInfo {
	const builtIn = getBuiltInInfiniAIModelMetadata(model.id);
	if (!builtIn) {
		return {
			...model,
			family: model.family ?? inferModelFamily(model.id),
		};
	}

	const capabilities = mergeCapabilities(model.capabilities, builtIn.capabilities);
	const imageInput = capabilities?.imageInput;

	return {
		...model,
		created: model.created || builtIn.created || 0,
		owned_by: model.owned_by || builtIn.manufacturer || "InfiniAI",
		family: model.family ?? builtIn.family ?? inferModelFamily(model.id),
		apiMode: model.apiMode ?? (builtIn.apiMode as ModelTransport | undefined),
		endpointKind: model.endpointKind ?? (builtIn.endpointKind as ModelEndpointKind | undefined),
		context_length: model.context_length ?? builtIn.maxContextTokens,
		max_tokens: model.max_tokens ?? builtIn.maxOutputTokens,
		maxInputTokens: model.maxInputTokens ?? builtIn.maxInputTokens,
		maxOutputTokens: model.maxOutputTokens ?? builtIn.maxOutputTokens,
		displayName: model.displayName ?? builtIn.name,
		version: model.version ?? builtIn.version,
		detail: model.detail ?? builtIn.detail,
		tooltip: model.tooltip ?? builtIn.tooltip,
		vision: model.vision ?? imageInput,
		input_modalities: model.input_modalities ?? (imageInput ? ["text", "image"] : undefined),
		capabilities,
	};
}
