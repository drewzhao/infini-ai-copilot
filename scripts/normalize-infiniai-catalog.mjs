#!/usr/bin/env node

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_INPUT = "reports/list-models.json";
const DEFAULT_OUTPUT = "reports/infiniai-model-metadata.generated.json";
const DEFAULT_TS_OUTPUT = "src/generated/infiniaiCatalogMetadata.generated.ts";
const PRACTICAL_OUTPUT_RESERVE_TOKENS = 16384;
const PRACTICAL_OUTPUT_RESERVE_CONTEXT_RATIO = 0.25;

const CHAT_TYPES = new Set(["大语言模型", "多模态模型"]);
const LOW_VALUE_DESCRIPTIONS = new Set(["", "test", "tets", "tet", "转发"]);

const SCENE_LABELS = new Map([
	["文本生成", "Text"],
	["代码生成", "Code"],
	["工具调用", "Tools"],
	["视觉理解", "Vision"],
	["文本向量", "Embeddings"],
	["图像生成", "Image generation"],
	["视频生成", "Video"],
	["文生视频", "Text-to-video"],
	["图生视频", "Image-to-video"],
	["基于首帧", "First-frame video"],
]);

const UNTRUSTED_SCENE_TAGS = new Set([
	// This tag is a broad product/catalog label, not evidence that a model
	// accepts request controls such as reasoning_effort or enable_thinking.
	"深度推理",
]);

function parseArgs(argv) {
	const args = [...argv];
	let input = DEFAULT_INPUT;
	let output = DEFAULT_OUTPUT;
	let tsOutput = DEFAULT_TS_OUTPUT;

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		}
		if (arg === "--input" || arg === "-i") {
			input = args[++i] ?? "";
			continue;
		}
		if (arg === "--output" || arg === "-o") {
			output = args[++i] ?? "";
			continue;
		}
		if (arg === "--ts-output") {
			tsOutput = args[++i] ?? "";
			continue;
		}
		if (!arg.startsWith("-") && input === DEFAULT_INPUT) {
			input = arg;
			continue;
		}
		if (!arg.startsWith("-") && output === DEFAULT_OUTPUT) {
			output = arg;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	if (!input) {
		throw new Error("Missing input path");
	}
	if (!output) {
		throw new Error("Missing output path");
	}

	return { input, output, tsOutput };
}

function printHelp() {
console.log(`Usage: node scripts/normalize-infiniai-catalog.mjs [--input reports/list-models.json] [--output reports/infiniai-model-metadata.generated.json] [--ts-output src/generated/infiniaiCatalogMetadata.generated.ts]

Parses a static InfiniAI model catalog snapshot and writes normalized candidate
built-in metadata for the extension. This utility does not fetch network data
and should not be used at extension runtime.`);
}

function assertObject(value, label) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value;
}

function extractCatalogList(parsed) {
	if (Array.isArray(parsed)) {
		return { modelList: parsed, resultTotal: parsed.length, responseShape: "array" };
	}

	const root = assertObject(parsed, "catalog root");
	if (Array.isArray(root.model_list)) {
		return { modelList: root.model_list, resultTotal: root.result_total, responseShape: "model_list" };
	}
	if (Array.isArray(root.data)) {
		return { modelList: root.data, resultTotal: root.data.length, responseShape: "data[]" };
	}
	if (root.data && typeof root.data === "object") {
		if (Array.isArray(root.data.model_list)) {
			return {
				modelList: root.data.model_list,
				resultTotal: root.data.result_total,
				responseShape: "data.model_list",
			};
		}
		if (Array.isArray(root.data.data)) {
			return { modelList: root.data.data, resultTotal: root.data.data.length, responseShape: "data.data[]" };
		}
	}

	throw new Error("Could not find a model list in the input JSON");
}

function stringOrUndefined(value) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOrUndefined(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function positiveIntegerOrUndefined(value) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function computePracticalOutputReserve(contextLength, providerMaxOutputTokens) {
	const context = positiveIntegerOrUndefined(contextLength);
	if (!context || context <= 1) {
		return 0;
	}
	const maxProviderReserve = positiveIntegerOrUndefined(providerMaxOutputTokens) ?? PRACTICAL_OUTPUT_RESERVE_TOKENS;
	const ratioReserve = Math.floor(context * PRACTICAL_OUTPUT_RESERVE_CONTEXT_RATIO);
	const reserve = Math.min(maxProviderReserve, PRACTICAL_OUTPUT_RESERVE_TOKENS, ratioReserve, context - 1);
	return Math.max(0, reserve);
}

function computeAdvertisedMaxInputTokens(contextLength, providerMaxOutputTokens) {
	const context = positiveIntegerOrUndefined(contextLength);
	if (!context) {
		return undefined;
	}
	return Math.max(1, context - computePracticalOutputReserve(context, providerMaxOutputTokens));
}

function unixSeconds(value) {
	const text = stringOrUndefined(value);
	if (!text) {
		return 0;
	}
	const ms = Date.parse(text);
	return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function unique(values) {
	return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function tagsByType(rawTags) {
	const result = new Map();
	if (!Array.isArray(rawTags)) {
		return result;
	}
	for (const rawTag of rawTags) {
		if (!rawTag || typeof rawTag !== "object") {
			continue;
		}
		const type = stringOrUndefined(rawTag.tag_type);
		const name = stringOrUndefined(rawTag.tag_name);
		if (!type || !name) {
			continue;
		}
		const list = result.get(type) ?? [];
		list.push(name);
		result.set(type, list);
	}
	for (const [type, list] of result) {
		result.set(type, unique(list));
	}
	return result;
}

function firstTag(tags, type) {
	return tags.get(type)?.[0];
}

function sceneLabels(scenes) {
	return scenes.map((scene) => SCENE_LABELS.get(scene) ?? scene);
}

function inferFamily(modelId) {
	const id = modelId.toLowerCase();
	const rules = [
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

function cleanDescription(description, modelId) {
	const text = stringOrUndefined(description);
	if (!text) {
		return undefined;
	}
	const lowered = text.toLowerCase();
	if (LOW_VALUE_DESCRIPTIONS.has(lowered) || lowered === modelId.toLowerCase()) {
		return undefined;
	}
	return text.length > 160 ? undefined : text;
}

function getProtocolOverride(modelId) {
	const id = modelId.toLowerCase();
	// Match OpenClaw's bundled Z.AI provider: GLM 4.5+ / 5+ models are
	// registered as openai-completions and called through /chat/completions.
	if (/^glm-(5|4\.(7|6|5))/.test(id)) {
		return { apiMode: "openai", endpointKind: "chat.completions" };
	}
	return undefined;
}

function buildDetail({ manufacturer, labels, isClaudeCompatible, promotion }) {
	const parts = [manufacturer, ...labels.filter((label) => label !== "Text")];
	if (isClaudeCompatible) {
		parts.push("Claude-compatible");
	}
	if (promotion) {
		parts.push(promotion);
	}
	return unique(parts).join(" · ");
}

function buildTooltip({ displayName, manufacturer, catalogType, scenes, contextLength, maxOutput, endpointType, billing, promotion, description }) {
	const lines = [`${displayName}`];
	if (manufacturer || catalogType) {
		lines.push(`Provider: ${[manufacturer, catalogType].filter(Boolean).join(" · ")}`);
	}
	if (scenes.length) {
		lines.push(`Capabilities: ${sceneLabels(scenes).join(", ")}`);
	}
	if (contextLength) {
		lines.push(`Context: ${contextLength.toLocaleString()} tokens`);
	}
	if (maxOutput) {
		lines.push(`Max output: ${maxOutput.toLocaleString()} tokens`);
	}
	if (endpointType) {
		lines.push(`Endpoint: ${endpointType}`);
	}
	if (promotion) {
		lines.push(`Promotion: ${promotion}`);
	}
	if (description) {
		lines.push(description);
	}
	if (billing?.expenses || billing?.billing_method || billing?.billing_cycle) {
		lines.push(`Billing: ${[billing.expenses, billing.billing_method, billing.billing_cycle].filter(Boolean).join(" · ")}`);
	}
	return lines.join("\n");
}

function normalizeModel(rawModel) {
	const raw = assertObject(rawModel, "model");
	const id = stringOrUndefined(raw.name);
	if (!id) {
		throw new Error("Catalog model is missing required string field `name`");
	}

	const tags = tagsByType(raw.tag_list);
	const catalogType = firstTag(tags, "type");
	const providerTag = firstTag(tags, "provider");
	const endpointType = firstTag(tags, "endpoint_type");
	const sizeLabel = firstTag(tags, "size");
	const gpu = firstTag(tags, "gpu") ?? stringOrUndefined(raw.default_gpu_name);
	const scenes = tags.get("scene") ?? [];
	const trustedScenes = scenes.filter((scene) => !UNTRUSTED_SCENE_TAGS.has(scene));
	const isChatCandidate = catalogType ? CHAT_TYPES.has(catalogType) : false;
	const isClaudeCompatible = endpointType === "Claude兼容";
	const manufacturer = stringOrUndefined(raw.manufacturer) ?? providerTag;
	const displayName = stringOrUndefined(raw.display_name) ?? id;
	const contextLength = numberOrUndefined(raw.context_length);
	const maxOutput = numberOrUndefined(raw.max_completion_tokens);
	const maxInput = computeAdvertisedMaxInputTokens(contextLength, maxOutput);
	const labels = sceneLabels(trustedScenes);
	const billing = raw.call_info && typeof raw.call_info === "object" ? {
		expenses: stringOrUndefined(raw.call_info.expenses),
		billing_method: stringOrUndefined(raw.call_info.billing_method),
		billing_cycle: stringOrUndefined(raw.call_info.billing_cycle),
		usage_statistics: typeof raw.call_info.usage_statistics === "boolean" ? raw.call_info.usage_statistics : undefined,
	} : undefined;
	const promotion = stringOrUndefined(raw.promotion);
	const description = cleanDescription(raw.description, id);

	const common = {
		id,
		name: displayName,
		family: inferFamily(id),
		version: stringOrUndefined(raw.release_time) ?? "0",
		created: unixSeconds(raw.release_time),
		manufacturer,
		catalogType,
		scenes: trustedScenes,
		providerTag,
		endpointType,
		sizeLabel,
		gpu,
		promotion,
		description,
		maasModelId: stringOrUndefined(raw.maas_model_id),
	};

	if (!isChatCandidate) {
		return {
			kind: "nonChat",
			...common,
			reason: catalogType ? `Catalog type ${catalogType} is not a VS Code chat model` : "Missing chat-capable catalog type",
		};
	}

	const protocolOverride = getProtocolOverride(id);
	const apiMode = protocolOverride?.apiMode ?? (isClaudeCompatible ? "anthropic" : "openai");
	const endpointKind = protocolOverride?.endpointKind ?? (isClaudeCompatible ? "messages" : "chat.completions");
	const isDefaultClaudeCompatible = endpointKind === "messages" && isClaudeCompatible;
	const displayEndpointType = isDefaultClaudeCompatible ? endpointType : undefined;

	return {
		kind: "chat",
		...common,
		maxContextTokens: contextLength,
		maxInputTokens: maxInput,
		maxOutputTokens: maxOutput,
		apiMode,
		endpointKind,
		detail: buildDetail({ manufacturer, labels, isClaudeCompatible: isDefaultClaudeCompatible, promotion }),
		tooltip: buildTooltip({
			displayName,
			manufacturer,
			catalogType,
			scenes: trustedScenes,
			contextLength,
			maxOutput,
			endpointType: displayEndpointType,
			billing,
			promotion,
			description,
		}),
		capabilities: {
			// The catalog's scene tags are positive evidence only. Some Claude-compatible
			// chat models omit the "工具调用" tag even though they should remain eligible
			// for VS Code agent-mode probing, so absence must not become an explicit false.
			toolCalling: trustedScenes.includes("工具调用") ? true : undefined,
			imageInput: trustedScenes.includes("视觉理解"),
			codeGeneration: trustedScenes.includes("代码生成"),
		},
		billing,
	};
}

function countBy(items, getter) {
	const counts = {};
	for (const item of items) {
		const key = getter(item) ?? "unknown";
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function pickRuntimeChatModel(model) {
	return {
		name: model.name,
		family: model.family,
		version: model.version,
		created: model.created,
		manufacturer: model.manufacturer,
		maxContextTokens: model.maxContextTokens,
		maxInputTokens: model.maxInputTokens,
		maxOutputTokens: model.maxOutputTokens,
		apiMode: model.apiMode,
		endpointKind: model.endpointKind,
		detail: model.detail,
		tooltip: model.tooltip,
		capabilities: model.capabilities,
	};
}

function pickRuntimeNonChatModel(model) {
	return {
		name: model.name,
		family: model.family,
		catalogType: model.catalogType,
		reason: model.reason,
	};
}

function pruneUndefined(value) {
	if (Array.isArray(value)) {
		return value.map(pruneUndefined);
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	const result = {};
	for (const [key, child] of Object.entries(value)) {
		if (child !== undefined) {
			result[key] = pruneUndefined(child);
		}
	}
	return result;
}

function stableRecord(items, mapper) {
	return Object.fromEntries(
		[...items]
			.sort((a, b) => a.id.localeCompare(b.id))
			.map((item) => [item.id, pruneUndefined(mapper(item))])
	);
}

function toTs(value) {
	return JSON.stringify(value, null, "\t");
}

function buildTsOutput(result) {
	const chatRecord = stableRecord(result.chatModels, pickRuntimeChatModel);
	const nonChatRecord = stableRecord(result.nonChatModels, pickRuntimeNonChatModel);
	return `// Generated by scripts/normalize-infiniai-catalog.mjs.
// Do not edit by hand. Refresh reports/list-models.json, then run npm run catalog:normalize.

export type BuiltInModelTransport = "openai" | "anthropic" | "vertex";
export type BuiltInEndpointKind = "chat.completions" | "messages" | "generateContent";

export interface BuiltInInfiniAIModelCapabilities {
\treadonly toolCalling?: boolean;
\treadonly imageInput?: boolean;
\treadonly codeGeneration?: boolean;
}

export interface BuiltInInfiniAIModelMetadata {
\treadonly name?: string;
\treadonly family?: string;
\treadonly version?: string;
\treadonly created?: number;
\treadonly manufacturer?: string;
\treadonly maxContextTokens?: number;
\treadonly maxInputTokens?: number;
\treadonly maxOutputTokens?: number;
\treadonly apiMode?: BuiltInModelTransport;
\treadonly endpointKind?: BuiltInEndpointKind;
\treadonly detail?: string;
\treadonly tooltip?: string;
\treadonly capabilities?: BuiltInInfiniAIModelCapabilities;
}

export interface BuiltInInfiniAINonChatModelMetadata {
\treadonly name?: string;
\treadonly family?: string;
\treadonly catalogType?: string;
\treadonly reason?: string;
}

export const BUILT_IN_INFINIAI_CATALOG_COUNTS = ${toTs(result.counts)} as const;

export const BUILT_IN_INFINIAI_MODEL_METADATA = ${toTs(chatRecord)} as const satisfies Record<string, BuiltInInfiniAIModelMetadata>;

export const BUILT_IN_INFINIAI_NON_CHAT_MODELS = ${toTs(nonChatRecord)} as const satisfies Record<string, BuiltInInfiniAINonChatModelMetadata>;
`;
}

async function main() {
	const { input, output, tsOutput } = parseArgs(process.argv.slice(2));
	const inputPath = path.resolve(input);
	const outputPath = path.resolve(output);
	const tsOutputPath = path.resolve(tsOutput);
	const parsed = JSON.parse(await readFile(inputPath, "utf8"));
	const { modelList, resultTotal, responseShape } = extractCatalogList(parsed);
	const normalized = modelList.map(normalizeModel);
	const chatModels = normalized.filter((model) => model.kind === "chat");
	const nonChatModels = normalized.filter((model) => model.kind === "nonChat");

	const result = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		source: {
			path: path.relative(process.cwd(), inputPath),
			responseShape,
			resultTotal: resultTotal ?? modelList.length,
		},
		counts: {
			raw: modelList.length,
			chat: chatModels.length,
			nonChat: nonChatModels.length,
			toolCalling: chatModels.filter((model) => model.capabilities.toolCalling).length,
			imageInput: chatModels.filter((model) => model.capabilities.imageInput).length,
			claudeCompatible: chatModels.filter((model) => model.endpointKind === "messages").length,
		},
		byCatalogType: countBy(normalized, (model) => model.catalogType),
		byManufacturer: countBy(normalized, (model) => model.manufacturer),
		chatModels,
		nonChatModels,
	};

	await mkdir(path.dirname(outputPath), { recursive: true });
	await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
	await mkdir(path.dirname(tsOutputPath), { recursive: true });
	await writeFile(tsOutputPath, buildTsOutput(result), "utf8");

	console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
	console.log(`Wrote ${path.relative(process.cwd(), tsOutputPath)}`);
	console.log(`Models: ${result.counts.raw} raw, ${result.counts.chat} chat, ${result.counts.nonChat} non-chat`);
	console.log(`Capabilities: ${result.counts.toolCalling} tools, ${result.counts.imageInput} vision`);
	console.log(`Routes: ${result.counts.claudeCompatible} Claude-compatible`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
