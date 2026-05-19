import type { ProvideLanguageModelChatResponseOptions } from "vscode";

import { resolveReasoningDialectProfile, type ReasoningDialectProfile } from "./reasoningDialect";
import { applyReasoningRequestControls } from "./reasoningRequest";
import type { InfiniAIModelInfo, ModelTransport } from "./types";

type ModelConfigurationRecord = Record<string, unknown>;

export type ReasoningEffort = "low" | "medium" | "high";
export type ThinkingMode = "enabled" | "disabled";

export interface InfiniAIModelConfiguration {
	readonly maxOutputTokens?: number;
	readonly reasoningEffort?: ReasoningEffort;
	readonly thinkingMode?: ThinkingMode;
}

export interface InfiniAIModelConfigurationPropertySchema {
	readonly type: "string" | "number";
	readonly title: string;
	readonly description?: string;
	readonly enum?: readonly unknown[];
	readonly enumItemLabels?: readonly string[];
	readonly enumDescriptions?: readonly string[];
	readonly default?: unknown;
	readonly group?: string;
	readonly minimum?: number;
	readonly maximum?: number;
}

export interface InfiniAIModelConfigurationSchema {
	readonly properties: Record<string, InfiniAIModelConfigurationPropertySchema>;
}

function isRecord(value: unknown): value is ModelConfigurationRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
	return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

function normalizeThinkingMode(value: unknown): ThinkingMode | undefined {
	return value === "enabled" || value === "disabled" ? value : undefined;
}

function normalizeMaxOutputTokens(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}
	const normalized = Math.floor(value);
	return normalized > 0 ? normalized : undefined;
}

function uniqueNumbers(values: readonly number[]): number[] {
	return [...new Set(values)];
}

function formatTokenLabel(value: number): string {
	if (value >= 1024 && value % 1024 === 0) {
		return `${value / 1024}K`;
	}
	return value.toLocaleString("en-US");
}

function getMaxOutputTokenChoices(maxOutputTokens: number): number[] {
	const bounded = Math.max(1, Math.floor(maxOutputTokens));
	return uniqueNumbers([0, 1024, 4096, 8192, 16384, bounded].filter((value) => value === 0 || value <= bounded));
}

function readRawModelConfiguration(options: ProvideLanguageModelChatResponseOptions): ModelConfigurationRecord {
	const hiddenOptions = options as ProvideLanguageModelChatResponseOptions & {
		readonly configuration?: unknown;
		readonly modelConfiguration?: unknown;
	};
	const configuration = isRecord(hiddenOptions.configuration) ? hiddenOptions.configuration : {};
	const modelConfiguration = isRecord(hiddenOptions.modelConfiguration) ? hiddenOptions.modelConfiguration : {};
	return {
		...configuration,
		...modelConfiguration,
	};
}

export function resolveInfiniAIModelConfiguration(
	options: ProvideLanguageModelChatResponseOptions
): InfiniAIModelConfiguration {
	const raw = readRawModelConfiguration(options);
	const resolved: InfiniAIModelConfiguration = {
		maxOutputTokens: normalizeMaxOutputTokens(raw.maxOutputTokens),
		reasoningEffort: normalizeReasoningEffort(raw.reasoningEffort),
		thinkingMode: normalizeThinkingMode(raw.thinkingMode),
	};
	return Object.fromEntries(Object.entries(resolved).filter(([, value]) => value !== undefined));
}

export function buildInfiniAIModelConfigurationSchema(
	model: InfiniAIModelInfo,
	maxOutputTokens: number,
	transport: ModelTransport = "openai"
): InfiniAIModelConfigurationSchema {
	const profile = resolveReasoningDialectProfile({ modelId: model.id, transport });
	const outputChoices = getMaxOutputTokenChoices(maxOutputTokens);
	const outputLabels = outputChoices.map((value) => (value === 0 ? "Model default" : formatTokenLabel(value)));
	const properties: Record<string, InfiniAIModelConfigurationPropertySchema> = {
		maxOutputTokens: {
			type: "number",
			title: "Max output tokens",
			description: "Caps the number of tokens the model may produce for a response.",
			enum: outputChoices,
			enumItemLabels: outputLabels,
			default: 0,
			group: "tokens",
			minimum: 0,
			maximum: Math.max(1, Math.floor(maxOutputTokens)),
		},
	};
	properties.reasoningEffort = {
		type: "string",
		title: "Reasoning effort",
		description:
			"Selected values send reasoning_effort on OpenAI-compatible routes; some models may ignore or reject it. Unset sends nothing.",
		enum: ["unset", "low", "medium", "high"],
		enumItemLabels: ["Unset", "Low", "Medium", "High"],
		enumDescriptions: [
			"Do not send reasoning_effort. Safest default when model support is unknown.",
			"Send reasoning_effort=low. The selected model may ignore or reject it.",
			"Send reasoning_effort=medium. The selected model may ignore or reject it.",
			"Send reasoning_effort=high. The selected model may ignore or reject it.",
		],
		default: "unset",
		group: "navigation",
	};

	const thinkingModes: string[] = ["unset"];
	const thinkingLabels: string[] = ["Unset"];
	const thinkingDescriptions: string[] = ["Use the provider default for this model profile."];
	if (profile.canDisableThinking) {
		thinkingModes.push("disabled");
		thinkingLabels.push("Disabled");
		thinkingDescriptions.push("Send the disable-thinking control supported by this model profile.");
	}
	if (profile.canEnableThinking) {
		thinkingModes.push("enabled");
		thinkingLabels.push("Enabled");
		thinkingDescriptions.push("Send the enable-thinking control supported by this model profile.");
	}
	if (thinkingModes.length > 1) {
		properties.thinkingMode = {
			type: "string",
			title: "Thinking mode",
			description: "Controls thinking only for model profiles with a confirmed request parameter.",
			enum: thinkingModes,
			enumItemLabels: thinkingLabels,
			enumDescriptions: thinkingDescriptions,
			default: "unset",
		};
	}

	return { properties };
}

export function applyOpenAIModelConfiguration(
	body: Record<string, unknown>,
	configuration: InfiniAIModelConfiguration,
	profile?: ReasoningDialectProfile
): void {
	if (configuration.maxOutputTokens !== undefined) {
		body.max_tokens = configuration.maxOutputTokens;
	}
	if (configuration.reasoningEffort !== undefined) {
		body.reasoning_effort = configuration.reasoningEffort;
	}
	const resolvedProfile =
		profile ??
		resolveReasoningDialectProfile({
			modelId: typeof body.model === "string" ? body.model : "",
			transport: "openai",
		});
	applyReasoningRequestControls(body, resolvedProfile, configuration);
}

export function applyAnthropicModelConfiguration(
	body: { max_tokens?: number },
	configuration: InfiniAIModelConfiguration
): void {
	if (configuration.maxOutputTokens !== undefined) {
		body.max_tokens = configuration.maxOutputTokens;
	}
}

export function applyVertexModelConfiguration(
	body: { generationConfig?: { maxOutputTokens?: number } },
	configuration: InfiniAIModelConfiguration
): void {
	if (configuration.maxOutputTokens === undefined) {
		return;
	}
	body.generationConfig = {
		...body.generationConfig,
		maxOutputTokens: configuration.maxOutputTokens,
	};
}
